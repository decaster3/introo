import { google } from 'googleapis';
import prisma from '../lib/prisma.js';
import { decryptToken, encryptToken } from '../middleware/auth.js';

interface MeetingInfo {
  title: string;
  date: Date;
  duration?: number;
  description?: string;
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
  // Remove everything after the last dot (any TLD)
  const withoutTld = domain.replace(/\.[^.]+$/, '');
  // If there's still a dot (e.g. "co.uk" → remove secondary TLD too)
  const base = withoutTld.replace(/\.(co|com|org|net|ac|gov)$/, '');
  const name = base
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

  // Auto-detect user timezone from Google Calendar settings
  try {
    const tzSetting = await calendar.settings.get({ setting: 'timezone' });
    const tz = tzSetting.data.value;
    if (tz) {
      await prisma.user.update({ where: { id: userId }, data: { timezone: tz } });
    }
  } catch {
    // Non-critical — timezone detection failure shouldn't block sync
  }

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
      const eventDescription = event.description || undefined;
      
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
          description: eventDescription,
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
    const meetingRows: { contactId: string; title: string; date: Date; duration?: number; description?: string }[] = [];
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
          description: m.description,
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
      const eventDescription = event.description || undefined;
      
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
          description: eventDescription,
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
    const meetingRows: { contactId: string; title: string; date: Date; duration?: number; description?: string }[] = [];
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
          description: m.description,
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

// ─── Daily Briefing helpers ──────────────────────────────────────────────────

export interface BriefingEvent {
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
  attendees: { email: string; name?: string }[];
}

export interface BriefingAttendeeInfo {
  email: string;
  name: string;
  title?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyIndustry?: string | null;
  companyEmployees?: number | null;
  companyFunding?: string | null;
  companyLinkedinUrl?: string | null;
  meetingsCount: number;
  strength: 'strong' | 'medium' | 'weak' | 'none';
  isInternal: boolean;
}

function formatEmailAsName(email: string): string {
  const prefix = email.split('@')[0];
  return prefix
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function strengthFromScore(score: number | null | undefined): 'strong' | 'medium' | 'weak' | 'none' {
  if (!score || score <= 0) return 'none';
  if (score >= 70) return 'strong';
  if (score >= 30) return 'medium';
  return 'weak';
}

/**
 * Fetch today's upcoming calendar events for a user directly from Google Calendar.
 * Returns events with attendees, sorted by start time.
 */
export async function getTodayEvents(userId: string, timezone: string): Promise<BriefingEvent[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, googleAccessToken: true, googleRefreshToken: true },
  });

  if (!user?.googleAccessToken) return [];

  const accessToken = decryptToken(user.googleAccessToken);
  const refreshToken = user.googleRefreshToken ? decryptToken(user.googleRefreshToken) : null;
  if (!accessToken) return [];

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      const enc = encryptToken(tokens.access_token);
      const encRef = tokens.refresh_token ? encryptToken(tokens.refresh_token) : user.googleRefreshToken;
      await prisma.user.update({ where: { id: userId }, data: { googleAccessToken: enc, googleRefreshToken: encRef } });
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Build today's time range in the user's timezone using Intl for accuracy
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;

  // Compute UTC offset for the target timezone (Google Calendar API requires RFC 3339)
  const refDate = new Date(`${dateStr}T12:00:00Z`);
  const utcStr = refDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = refDate.toLocaleString('en-US', { timeZone: timezone });
  const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  const offsetSign = offsetMs <= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMs);
  const offsetH = String(Math.floor(absOffset / 3600000)).padStart(2, '0');
  const offsetM = String(Math.floor((absOffset % 3600000) / 60000)).padStart(2, '0');
  const offsetSuffix = `${offsetSign}${offsetH}:${offsetM}`;

  const timeMin = `${dateStr}T00:00:00${offsetSuffix}`;
  const timeMax = `${dateStr}T23:59:59${offsetSuffix}`;

  const events: BriefingEvent[] = [];
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      timeZone: timezone,
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
      pageToken,
    });

    for (const event of response.data.items || []) {
      if (event.status === 'cancelled') continue;
      if (!event.start?.dateTime) continue; // skip all-day events
      if (!event.attendees || event.attendees.length === 0) continue;

      const start = new Date(event.start.dateTime);
      const end = event.end?.dateTime ? new Date(event.end.dateTime) : start;
      const duration = Math.round((end.getTime() - start.getTime()) / 60000);

      const attendees = event.attendees
        .filter(a => a.email && a.email.toLowerCase() !== user.email.toLowerCase() && !a.resource)
        .map(a => ({ email: a.email!.toLowerCase(), name: a.displayName || undefined }));

      if (attendees.length === 0) continue;

      // Only include events that haven't ended yet
      if (end > now) {
        events.push({
          title: event.summary || 'Untitled meeting',
          startTime: event.start.dateTime,
          endTime: event.end?.dateTime || event.start.dateTime,
          duration,
          attendees,
        });
      }
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return events;
}

/**
 * Ensure all attendee emails have Contact + Company records in Introo.
 * Returns enriched attendee info for the email template.
 */
export async function ensureContactsForBriefing(
  userId: string,
  emails: string[]
): Promise<Map<string, BriefingAttendeeInfo>> {
  const uniqueEmails = [...new Set(emails.filter(e => isBusinessEmail(e)))];
  const result = new Map<string, BriefingAttendeeInfo>();

  // Determine the user's internal domains
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, companyDomain: true },
  });
  const userDomain = user?.email ? extractDomain(user.email) : '';
  const internalDomains = new Set<string>([userDomain, user?.companyDomain || ''].filter(Boolean).map(d => d.toLowerCase()));

  const existingContacts = await prisma.contact.findMany({
    where: { userId, email: { in: uniqueEmails } },
    select: {
      email: true, name: true, title: true, meetingsCount: true, linkedinUrl: true,
      companyId: true,
      company: { select: {
        name: true, domain: true, industry: true, employeeCount: true,
        totalFunding: true, lastFundingRound: true, linkedinUrl: true,
      } },
    },
  });

  // Fetch relationship strength per company
  const companyIds = [...new Set(existingContacts.map(c => c.companyId).filter(Boolean))] as string[];
  const relationships = companyIds.length > 0
    ? await prisma.relationship.findMany({
        where: { userId, companyId: { in: companyIds } },
        select: { companyId: true, strengthScore: true },
      })
    : [];
  const strengthByCompany = new Map(relationships.map(r => [r.companyId, r.strengthScore]));

  const existingMap = new Map(existingContacts.map(c => [c.email.toLowerCase(), c]));

  for (const email of uniqueEmails) {
    const domain = extractDomain(email);
    const isInternal = internalDomains.has(domain.toLowerCase());
    const existing = existingMap.get(email);

    if (existing) {
      const score = existing.companyId ? strengthByCompany.get(existing.companyId) : null;
      result.set(email, {
        email,
        name: existing.name || formatEmailAsName(email),
        title: existing.title,
        linkedinUrl: existing.linkedinUrl,
        companyName: existing.company?.name || null,
        companyDomain: existing.company?.domain || domain,
        companyIndustry: existing.company?.industry || null,
        companyEmployees: existing.company?.employeeCount || null,
        companyFunding: existing.company?.totalFunding || existing.company?.lastFundingRound || null,
        companyLinkedinUrl: existing.company?.linkedinUrl || null,
        meetingsCount: existing.meetingsCount || 0,
        strength: strengthFromScore(score),
        isInternal,
      });
      continue;
    }

    // Create new contact + company
    let companyId: string | undefined;
    let companyName: string | null = null;

    if (domain) {
      const company = await prisma.company.upsert({
        where: { domain },
        create: { domain, name: normalizeCompanyName(domain) },
        update: {},
        select: { id: true, name: true },
      });
      companyId = company.id;
      companyName = company.name;
    }

    result.set(email, {
      email,
      name: formatEmailAsName(email),
      title: null,
      linkedinUrl: null,
      companyName,
      companyDomain: domain || null,
      companyIndustry: null,
      companyEmployees: null,
      companyFunding: null,
      companyLinkedinUrl: null,
      meetingsCount: 0,
      strength: 'none',
      isInternal,
    });

    const existingByEmail = await prisma.contact.findFirst({
      where: { userId, email },
    });
    if (!existingByEmail) {
      await prisma.contact.create({
        data: {
          email,
          name: formatEmailAsName(email),
          userId,
          companyId,
          meetingsCount: 0,
          lastSeenAt: new Date(),
          source: 'briefing',
        },
      });
    }
  }

  return result;
}
