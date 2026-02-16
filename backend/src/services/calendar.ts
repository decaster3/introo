import { google } from 'googleapis';
import prisma from '../lib/prisma.js';
import { decryptToken, encryptToken } from '../middleware/auth.js';

interface MeetingInfo {
  title: string;
  date: Date;
  duration?: number;
}

interface CalendarContact {
  email: string;
  name?: string;
  domain: string;
  meetingsCount: number;
  lastSeenAt: Date;
  lastEventTitle?: string;
  meetings: MeetingInfo[];
}

// Common email domains to ignore (personal emails)
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com',
  'mail.com', 'zoho.com', 'yandex.com', 'gmx.com', 'fastmail.com'
]);

// System/calendar domains to ignore (not real contacts)
const SYSTEM_DOMAIN_PATTERNS = [
  'calendar.google.com',      // Google Calendar system addresses
  'group.calendar.google.com', // Google Calendar groups
  'resource.calendar.google.com', // Google Calendar resources (rooms, etc)
  'noreply',                  // No-reply addresses
  'no-reply',
  'notifications',
  'calendar-notification',
];

function extractDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

function isSystemEmail(email: string): boolean {
  const lowerEmail = email.toLowerCase();
  return SYSTEM_DOMAIN_PATTERNS.some(pattern => lowerEmail.includes(pattern));
}

function isBusinessEmail(email: string): boolean {
  const domain = extractDomain(email);
  if (domain.length === 0) return false;
  if (PERSONAL_DOMAINS.has(domain)) return false;
  if (isSystemEmail(email)) return false;
  return true;
}

function normalizeCompanyName(domain: string): string {
  // Remove common TLDs and format as company name
  const name = domain
    .replace(/\.(com|io|co|org|net|ai|app|dev|tech)$/, '')
    .split('.')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return name;
}

export async function syncCalendarForUser(userId: string): Promise<{
  contactsFound: number;
  companiesFound: number;
  relationshipsCreated: number;
}> {
  // Get user basic info
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, googleAccessToken: true, googleRefreshToken: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Try to read tokens from CalendarAccount first (single source of truth)
  const existingAccount = await prisma.calendarAccount.findUnique({
    where: { userId_email: { userId, email: user.email } },
    select: { id: true, googleAccessToken: true, googleRefreshToken: true },
  });

  const encryptedAccessToken = existingAccount?.googleAccessToken || user.googleAccessToken;
  const encryptedRefreshToken = existingAccount?.googleRefreshToken || user.googleRefreshToken;

  if (!encryptedAccessToken) {
    throw new Error('User has no Google access token');
  }

  const accessToken = decryptToken(encryptedAccessToken);
  const refreshToken = encryptedRefreshToken ? decryptToken(encryptedRefreshToken) : null;

  if (!accessToken) {
    // Token decryption failed — clear both sources and force re-auth
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { googleAccessToken: null, googleRefreshToken: null },
      }),
      ...(existingAccount
        ? [prisma.calendarAccount.update({
            where: { id: existingAccount.id },
            data: { googleAccessToken: '', googleRefreshToken: null },
          })]
        : []),
    ]);
    const error = new Error('Calendar access expired. Please sign out and sign in again.');
    (error as any).code = 401;
    throw error;
  }

  // Set up OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  // Handle token refresh — write to CalendarAccount as the canonical source
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      const encryptedAccess = encryptToken(tokens.access_token);
      const encryptedRefresh = tokens.refresh_token
        ? encryptToken(tokens.refresh_token)
        : encryptedRefreshToken;

      // Update CalendarAccount (primary source)
      if (existingAccount) {
        await prisma.calendarAccount.update({
          where: { id: existingAccount.id },
          data: { googleAccessToken: encryptedAccess, googleRefreshToken: encryptedRefresh },
        });
      }
      // Also update User for backward compat (will be removed in future)
      await prisma.user.update({
        where: { id: userId },
        data: { googleAccessToken: encryptedAccess, googleRefreshToken: encryptedRefresh },
      });
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Fetch events from the past 5 years
  const now = new Date();
  const fiveYearsAgo = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);

  const contactsMap = new Map<string, CalendarContact>();
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: fiveYearsAgo.toISOString(),
      timeMax: now.toISOString(),
      maxResults: 250,
      singleEvents: true,
      orderBy: 'startTime',
      pageToken,
    });

    const events = response.data.items || [];

    for (const event of events) {
      const attendees = event.attendees || [];
      const eventDate = new Date(event.start?.dateTime || event.start?.date || now);
      const eventTitle = event.summary || 'Untitled meeting';
      
      // Calculate duration in minutes
      let duration: number | undefined;
      if (event.start?.dateTime && event.end?.dateTime) {
        const start = new Date(event.start.dateTime);
        const end = new Date(event.end.dateTime);
        duration = Math.round((end.getTime() - start.getTime()) / 60000);
      }

      for (const attendee of attendees) {
        const email = attendee.email?.toLowerCase();
        if (!email || email === user.email.toLowerCase() || !isBusinessEmail(email)) {
          continue;
        }

        const domain = extractDomain(email);
        const existing = contactsMap.get(email);
        
        const meetingInfo: MeetingInfo = {
          title: eventTitle,
          date: eventDate,
          duration,
        };

        if (existing) {
          existing.meetingsCount++;
          existing.meetings.push(meetingInfo);
          if (eventDate > existing.lastSeenAt) {
            existing.lastSeenAt = eventDate;
            existing.lastEventTitle = eventTitle;
            existing.name = attendee.displayName || existing.name;
          }
        } else {
          contactsMap.set(email, {
            email,
            name: attendee.displayName || undefined,
            domain,
            meetingsCount: 1,
            lastSeenAt: eventDate,
            lastEventTitle: eventTitle,
            meetings: [meetingInfo],
          });
        }
      }
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  // Process contacts and create/update database records
  const contacts = Array.from(contactsMap.values());
  const domainsSet = new Set(contacts.map(c => c.domain));

  // Ensure a CalendarAccount exists for the primary email (source tracking + single token source)
  const primaryAccount = await prisma.calendarAccount.upsert({
    where: { userId_email: { userId, email: user.email } },
    update: {
      googleAccessToken: encryptedAccessToken,
      googleRefreshToken: encryptedRefreshToken ?? undefined,
    },
    create: {
      userId,
      email: user.email,
      googleAccessToken: encryptedAccessToken,
      googleRefreshToken: encryptedRefreshToken ?? undefined,
    },
  });

  // Batch upsert companies
  const companyMap = new Map<string, string>();
  const domainBatches = Array.from(domainsSet);
  const BATCH_SIZE = 50;

  for (let i = 0; i < domainBatches.length; i += BATCH_SIZE) {
    const batch = domainBatches.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map(domain =>
        prisma.company.upsert({
          where: { domain },
          update: {},
          create: { domain, name: normalizeCompanyName(domain) },
        })
      )
    );
  }

  // Fetch all company IDs in one query
  const allCompanies = await prisma.company.findMany({
    where: { domain: { in: domainBatches } },
    select: { id: true, domain: true },
  });
  allCompanies.forEach(c => companyMap.set(c.domain, c.id));

  // Batch upsert contacts in transactions
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);

    const dbContacts = await prisma.$transaction(
      batch.map(contact => {
        const companyId = companyMap.get(contact.domain);
        return prisma.contact.upsert({
          where: { userId_email: { userId, email: contact.email } },
          update: {
            name: contact.name,
            meetingsCount: contact.meetingsCount,
            lastSeenAt: contact.lastSeenAt,
            lastEventTitle: contact.lastEventTitle,
            companyId,
            isApproved: true,
          },
          create: {
            userId,
            email: contact.email,
            name: contact.name,
            companyId,
            meetingsCount: contact.meetingsCount,
            lastSeenAt: contact.lastSeenAt,
            lastEventTitle: contact.lastEventTitle,
            isApproved: true,
          },
        });
      })
    );

    // Connect source accounts in batch
    await prisma.$transaction(
      dbContacts.map(c =>
        prisma.contact.update({
          where: { id: c.id },
          data: { sourceAccounts: { connect: { id: primaryAccount.id } } },
        })
      )
    );

    // Delete old meetings in batch
    await prisma.meeting.deleteMany({
      where: { contactId: { in: dbContacts.map(c => c.id) } },
    });

    // Bulk insert meetings with createMany
    const meetingRows: { contactId: string; title: string; date: Date; duration?: number }[] = [];
    batch.forEach((contact, idx) => {
      const dbContact = dbContacts[idx];
      const recentMeetings = contact.meetings
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 10);
      recentMeetings.forEach(m => {
        meetingRows.push({
          contactId: dbContact.id,
          title: m.title,
          date: m.date,
          duration: m.duration,
        });
      });
    });

    if (meetingRows.length > 0) {
      await prisma.meeting.createMany({ data: meetingRows });
    }
  }

  // Count unique companies (for stats)
  const relationshipsCreated = 0; // Now handled in approve flow

  // Update user's sync timestamp and primary account sync timestamp
  await prisma.user.update({
    where: { id: userId },
    data: { calendarSyncedAt: now },
  });
  await prisma.calendarAccount.update({
    where: { id: primaryAccount.id },
    data: { lastSyncedAt: now },
  });

  return {
    contactsFound: contacts.length,
    companiesFound: domainsSet.size,
    relationshipsCreated,
  };
}

export async function getCalendarSyncStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { calendarSyncedAt: true, googleAccessToken: true },
  });

  const accounts = await prisma.calendarAccount.findMany({
    where: { userId, isActive: true },
    select: { id: true, email: true, lastSyncedAt: true },
  });

  return {
    isConnected: !!user?.googleAccessToken || accounts.length > 0,
    lastSyncedAt: user?.calendarSyncedAt,
    accountsCount: accounts.length,
  };
}

// Get all calendar accounts for a user
export async function getCalendarAccounts(userId: string) {
  const accounts = await prisma.calendarAccount.findMany({
    where: { userId },
    select: {
      id: true,
      email: true,
      name: true,
      lastSyncedAt: true,
      isActive: true,
      createdAt: true,
      _count: {
        select: { contacts: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return accounts.map(a => ({
    id: a.id,
    email: a.email,
    name: a.name,
    lastSyncedAt: a.lastSyncedAt,
    isActive: a.isActive,
    contactsCount: a._count.contacts,
  }));
}

// Sync a specific calendar account
export async function syncCalendarAccount(userId: string, accountId: string): Promise<{
  contactsFound: number;
  companiesFound: number;
}> {
  const account = await prisma.calendarAccount.findFirst({
    where: { id: accountId, userId },
  });

  if (!account) {
    throw new Error('Calendar account not found');
  }

  // Decrypt tokens
  const accessToken = decryptToken(account.googleAccessToken);
  const refreshToken = account.googleRefreshToken ? decryptToken(account.googleRefreshToken) : null;

  if (!accessToken) {
    throw new Error('Calendar access expired. Please reconnect this account.');
  }

  // Set up OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  // Handle token refresh
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      const encryptedAccess = encryptToken(tokens.access_token);
      const encryptedRefresh = tokens.refresh_token 
        ? encryptToken(tokens.refresh_token) 
        : account.googleRefreshToken;
      
      await prisma.calendarAccount.update({
        where: { id: accountId },
        data: {
          googleAccessToken: encryptedAccess,
          googleRefreshToken: encryptedRefresh,
        },
      });
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Fetch events from the past 5 years
  const now = new Date();
  const fiveYearsAgo = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);

  const contactsMap = new Map<string, CalendarContact>();
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: fiveYearsAgo.toISOString(),
      timeMax: now.toISOString(),
      maxResults: 250,
      singleEvents: true,
      orderBy: 'startTime',
      pageToken,
    });

    const events = response.data.items || [];

    for (const event of events) {
      const attendees = event.attendees || [];
      const eventDate = new Date(event.start?.dateTime || event.start?.date || now);
      const eventTitle = event.summary || 'Untitled meeting';
      
      let duration: number | undefined;
      if (event.start?.dateTime && event.end?.dateTime) {
        const start = new Date(event.start.dateTime);
        const end = new Date(event.end.dateTime);
        duration = Math.round((end.getTime() - start.getTime()) / 60000);
      }

      for (const attendee of attendees) {
        const email = attendee.email?.toLowerCase();
        if (!email || email === account.email.toLowerCase() || !isBusinessEmail(email)) {
          continue;
        }

        const domain = extractDomain(email);
        const existing = contactsMap.get(email);
        
        const meetingInfo: MeetingInfo = {
          title: eventTitle,
          date: eventDate,
          duration,
        };

        if (existing) {
          existing.meetingsCount++;
          existing.meetings.push(meetingInfo);
          if (eventDate > existing.lastSeenAt) {
            existing.lastSeenAt = eventDate;
            existing.lastEventTitle = eventTitle;
            existing.name = attendee.displayName || existing.name;
          }
        } else {
          contactsMap.set(email, {
            email,
            name: attendee.displayName || undefined,
            domain,
            meetingsCount: 1,
            lastSeenAt: eventDate,
            lastEventTitle: eventTitle,
            meetings: [meetingInfo],
          });
        }
      }
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  const contacts = Array.from(contactsMap.values());
  const domainsSet = new Set(contacts.map(c => c.domain));

  // Batch upsert companies
  const companyMap = new Map<string, string>();
  const domainBatches = Array.from(domainsSet);
  const BATCH_SIZE = 50;

  for (let i = 0; i < domainBatches.length; i += BATCH_SIZE) {
    const batch = domainBatches.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map(domain =>
        prisma.company.upsert({
          where: { domain },
          update: {},
          create: { domain, name: normalizeCompanyName(domain) },
        })
      )
    );
  }

  const allCompanies = await prisma.company.findMany({
    where: { domain: { in: domainBatches } },
    select: { id: true, domain: true },
  });
  allCompanies.forEach(c => companyMap.set(c.domain, c.id));

  // Batch upsert contacts with source tracking
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);

    const dbContacts = await prisma.$transaction(
      batch.map(contact => {
        const companyId = companyMap.get(contact.domain);
        return prisma.contact.upsert({
          where: { userId_email: { userId, email: contact.email } },
          update: {
            name: contact.name,
            meetingsCount: contact.meetingsCount,
            lastSeenAt: contact.lastSeenAt,
            lastEventTitle: contact.lastEventTitle,
            companyId,
            isApproved: true,
            source: 'google_calendar',
            sourceAccountId: accountId,
          },
          create: {
            userId,
            email: contact.email,
            name: contact.name,
            companyId,
            meetingsCount: contact.meetingsCount,
            lastSeenAt: contact.lastSeenAt,
            lastEventTitle: contact.lastEventTitle,
            isApproved: true,
            source: 'google_calendar',
            sourceAccountId: accountId,
          },
        });
      })
    );

    // Connect source accounts in batch
    await prisma.$transaction(
      dbContacts.map(c =>
        prisma.contact.update({
          where: { id: c.id },
          data: { sourceAccounts: { connect: { id: accountId } } },
        })
      )
    );

    // Delete old meetings in batch
    await prisma.meeting.deleteMany({
      where: { contactId: { in: dbContacts.map(c => c.id) } },
    });

    // Bulk insert meetings with createMany
    const meetingRows: { contactId: string; title: string; date: Date; duration?: number }[] = [];
    batch.forEach((contact, idx) => {
      const dbContact = dbContacts[idx];
      const recentMeetings = contact.meetings
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 10);
      recentMeetings.forEach(m => {
        meetingRows.push({
          contactId: dbContact.id,
          title: m.title,
          date: m.date,
          duration: m.duration,
        });
      });
    });

    if (meetingRows.length > 0) {
      await prisma.meeting.createMany({ data: meetingRows });
    }
  }

  // Update account sync timestamp
  await prisma.calendarAccount.update({
    where: { id: accountId },
    data: { lastSyncedAt: now },
  });

  return {
    contactsFound: contacts.length,
    companiesFound: domainsSet.size,
  };
}
