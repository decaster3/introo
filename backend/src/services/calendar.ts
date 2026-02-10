import { google, calendar_v3 } from 'googleapis';
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
  // Get user with tokens
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, googleAccessToken: true, googleRefreshToken: true },
  });

  if (!user?.googleAccessToken) {
    throw new Error('User has no Google access token');
  }

  // Decrypt tokens before use
  const accessToken = decryptToken(user.googleAccessToken);
  const refreshToken = user.googleRefreshToken ? decryptToken(user.googleRefreshToken) : null;

  if (!accessToken) {
    // Token decryption failed - likely due to encryption key change after backend restart
    // Clear the invalid tokens and force re-authentication
    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: null,
        googleRefreshToken: null,
      },
    });
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

  // Handle token refresh - encrypt new tokens before storing
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      const encryptedAccess = encryptToken(tokens.access_token);
      const encryptedRefresh = tokens.refresh_token 
        ? encryptToken(tokens.refresh_token) 
        : user.googleRefreshToken;
      
      await prisma.user.update({
        where: { id: userId },
        data: {
          googleAccessToken: encryptedAccess,
          googleRefreshToken: encryptedRefresh,
        },
      });
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Fetch events from the past 12 months
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const contactsMap = new Map<string, CalendarContact>();
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: oneYearAgo.toISOString(),
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

  // Upsert companies
  const companyMap = new Map<string, string>(); // domain -> companyId
  for (const domain of domainsSet) {
    const company = await prisma.company.upsert({
      where: { domain },
      update: {},
      create: {
        domain,
        name: normalizeCompanyName(domain),
      },
    });
    companyMap.set(domain, company.id);
  }

  // Upsert contacts and their meetings
  for (const contact of contacts) {
    const companyId = companyMap.get(contact.domain);

    const dbContact = await prisma.contact.upsert({
      where: {
        userId_email: { userId, email: contact.email },
      },
      update: {
        name: contact.name,
        meetingsCount: contact.meetingsCount,
        lastSeenAt: contact.lastSeenAt,
        lastEventTitle: contact.lastEventTitle,
        companyId,
        isApproved: true, // Auto-approve on sync
      },
      create: {
        userId,
        email: contact.email,
        name: contact.name,
        companyId,
        meetingsCount: contact.meetingsCount,
        lastSeenAt: contact.lastSeenAt,
        lastEventTitle: contact.lastEventTitle,
        isApproved: true, // Auto-approve calendar contacts
      },
    });

    // Delete existing meetings and insert new ones (full refresh)
    await prisma.meeting.deleteMany({
      where: { contactId: dbContact.id },
    });

    // Insert meetings (limit to last 10 for performance)
    const recentMeetings = contact.meetings
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 10);

    for (const meeting of recentMeetings) {
      await prisma.meeting.create({
        data: {
          contactId: dbContact.id,
          title: meeting.title,
          date: meeting.date,
          duration: meeting.duration,
        },
      });
    }
  }

  // Count unique companies (for stats)
  const relationshipsCreated = 0; // Now handled in approve flow

  // Update user's sync timestamp
  await prisma.user.update({
    where: { id: userId },
    data: { calendarSyncedAt: now },
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

  return {
    isConnected: !!user?.googleAccessToken,
    lastSyncedAt: user?.calendarSyncedAt,
  };
}
