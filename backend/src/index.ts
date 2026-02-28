import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import rateLimit from 'express-rate-limit';

import { configurePassport } from './middleware/auth.js';
import { securityHeaders, httpsRedirect } from './middleware/security.js';
import { syncCalendarForUser, syncCalendarAccount, getTodayEvents, ensureContactsForBriefing } from './services/calendar.js';
import authRoutes from './routes/auth.js';
import calendarRoutes from './routes/calendar.js';
import usersRoutes from './routes/users.js';
import requestsRoutes from './routes/requests.js';
import offersRoutes from './routes/offers.js';
import relationshipsRoutes from './routes/relationships.js';
import spacesRoutes from './routes/spaces.js';
import signalsRoutes from './routes/signals.js';
import enrichmentRoutes, { runEnrichmentForUser } from './routes/enrichment.js';
import connectionsRoutes from './routes/connections.js';
import notificationsRoutes from './routes/notifications.js';
import tagsRoutes from './routes/tags.js';
import aiRoutes from './routes/ai.js';
import emailRoutes from './routes/email.js';
import viewsRoutes from './routes/views.js';
import adminRoutes from './routes/admin.js';
import embeddingsRoutes from './routes/embeddings.js';
import historyRoutes from './routes/history.js';
import { sendWeeklyDigest, sendDailyBriefing, sendCalendarReminderEmail, sendConnectionReminderEmail, sendIntroNudgeEmail, sendInviteReminderEmail, sendSpaceInviteReminderEmail } from './services/email.js';
import type { BriefingMeeting, BriefingAttendee } from './services/email.js';
import prisma from './lib/prisma.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Environment variable validation
const requiredEnvVars = ['DATABASE_URL'];
const recommendedEnvVars = ['JWT_SECRET', 'ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FRONTEND_URL', 'APOLLO_API_KEY', 'OPENAI_API_KEY', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'APIFY_API_TOKEN'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === 'production') {
  for (const envVar of recommendedEnvVars) {
    if (!process.env[envVar]) {
      console.warn(`WARNING: Missing recommended environment variable: ${envVar}`);
    }
  }
}

// Rate limiting - more lenient in development
const isProduction = process.env.NODE_ENV === 'production';

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 1000 : 10000, // Much higher limit in dev
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isProduction, // Skip rate limiting in development
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 50 : 1000, // Much higher limit in dev
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isProduction, // Skip rate limiting in development
});

// Trust proxy — required for Railway (and any reverse-proxy deployment)
// so that req.ip, req.secure, and rate limiting work correctly.
app.set('trust proxy', 1);

// Health check — placed before all middleware so Railway's internal
// HTTP healthcheck isn't blocked by HTTPS redirect or rate limiting.
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy', 
      timestamp: new Date().toISOString(),
      database: 'disconnected'
    });
  }
});

// Middleware
// Security headers first
app.use(securityHeaders);

// HTTPS redirect in production
if (isProduction) {
  app.use(httpsRedirect);
}

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(globalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(passport.initialize());

// Configure passport strategies
configurePassport();

// Routes with stricter rate limiting on auth
app.use('/auth', authLimiter, authRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api/relationships', relationshipsRoutes);
app.use('/api/spaces', spacesRoutes);
app.use('/api/signals', signalsRoutes);
app.use('/api/enrichment', enrichmentRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/views', viewsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/embeddings', embeddingsRoutes);
app.use('/api/history', historyRoutes);

// Debug endpoint - development only
if (!isProduction) {
  app.get('/debug/env', (req, res) => {
    res.json({
      FRONTEND_URL: process.env.FRONTEND_URL || 'NOT SET',
      GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || 'NOT SET',
      NODE_ENV: process.env.NODE_ENV || 'NOT SET',
      PORT: process.env.PORT || 'NOT SET',
    });
  });
}

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err.message);
  
  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;
  
  res.status(500).json({ error: message });
});

// Database connection verification
async function verifyDatabaseConnection() {
  try {
    await prisma.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }
}

// Graceful shutdown
let server: ReturnType<typeof app.listen>;

async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  server.close(async () => {
    console.log('HTTP server closed');
    
    try {
      await prisma.$disconnect();
      console.log('Database connection closed');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// ─── Background calendar sync (every 4 hours) ───────────────────────────────

const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

let syncRunning = false;

async function backgroundCalendarSync() {
  if (syncRunning) {
    console.log('[cron] Skipping calendar sync — previous run still in progress');
    return;
  }
  syncRunning = true;
  console.log('[cron] Starting background calendar sync for all users...');
  try {
    // Get all users that have calendar connected (primary tokens)
    const users = await prisma.user.findMany({
      where: { googleAccessToken: { not: null } },
      select: { id: true, email: true },
    });

    for (const user of users) {
      try {
        await syncCalendarForUser(user.id);
        console.log(`[cron] Synced primary calendar for ${user.email}`);
      } catch (err) {
        console.error(`[cron] Failed to sync primary for ${user.email}:`, (err as Error).message);
      }
    }

    // Sync all additional calendar accounts
    const accounts = await prisma.calendarAccount.findMany({
      where: { isActive: true },
      select: { id: true, email: true, userId: true },
    });

    for (const acct of accounts) {
      try {
        // Skip primary accounts (already synced above via syncCalendarForUser)
        const owner = users.find(u => u.id === acct.userId);
        if (owner && acct.email.toLowerCase() === owner.email.toLowerCase()) continue;

        await syncCalendarAccount(acct.userId, acct.id);
        console.log(`[cron] Synced additional account ${acct.email}`);
      } catch (err) {
        console.error(`[cron] Failed to sync account ${acct.email}:`, (err as Error).message);
      }
    }

    console.log('[cron] Background calendar sync complete');

    // Run enrichment for all users with contacts (weekly cadence enforced by 7-day cache)
    console.log('[cron] Starting background enrichment for all users...');
    const allUsers = await prisma.user.findMany({
      where: { contacts: { some: {} } },
      select: { id: true, email: true },
    });

    for (const u of allUsers) {
      try {
        await runEnrichmentForUser(u.id);
        console.log(`[cron] Queued enrichment for ${u.email}`);
      } catch (err) {
        console.error(`[cron] Failed to queue enrichment for ${u.email}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[cron] Background sync error:', err);
  } finally {
    syncRunning = false;
  }
}

// ─── Weekly digest email (every 7 days) ──────────────────────────────────────

const DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

async function backgroundWeeklyDigest() {
  console.log('[cron] Starting weekly digest emails...');
  try {
    const now = Date.now();
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const todayStr = new Date().toISOString().slice(0, 10);

    const users = await prisma.user.findMany({
      where: { googleAccessToken: { not: null } },
      select: { id: true, email: true, lastDigestDate: true },
    });

    for (const user of users) {
      try {
        if (user.lastDigestDate === todayStr) continue;

        const [
          newContacts, newMeetings, introsSent, introsReceived, introsDone,
          prevContacts, prevMeetings, prevIntrosSent, prevIntrosReceived,
          pendingRequestsForYou, pendingOffersForYou, unansweredConnectionRequests,
          topCompanies,
        ] = await Promise.all([
          // This week
          prisma.contact.count({ where: { userId: user.id, createdAt: { gte: oneWeekAgo } } }),
          prisma.meeting.count({ where: { contact: { userId: user.id }, date: { gte: oneWeekAgo } } }),
          prisma.introRequest.count({ where: { requesterId: user.id, createdAt: { gte: oneWeekAgo } } }),
          prisma.introRequest.count({
            where: {
              createdAt: { gte: oneWeekAgo },
              OR: [
                { space: { members: { some: { userId: user.id, status: 'approved' } } } },
                { requester: { sentConnections: { some: { toUserId: user.id, status: 'accepted' } } } },
                { requester: { receivedConnections: { some: { fromUserId: user.id, status: 'accepted' } } } },
              ],
              requesterId: { not: user.id },
            },
          }),
          prisma.introOffer.count({
            where: {
              status: 'done',
              updatedAt: { gte: oneWeekAgo },
              OR: [{ introducerId: user.id }, { request: { requesterId: user.id } }],
            },
          }),
          // Previous week (for trend comparison)
          prisma.contact.count({ where: { userId: user.id, createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } } }),
          prisma.meeting.count({ where: { contact: { userId: user.id }, date: { gte: twoWeeksAgo, lt: oneWeekAgo } } }),
          prisma.introRequest.count({ where: { requesterId: user.id, createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } } }),
          prisma.introRequest.count({
            where: {
              createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
              OR: [
                { space: { members: { some: { userId: user.id, status: 'approved' } } } },
                { requester: { sentConnections: { some: { toUserId: user.id, status: 'accepted' } } } },
                { requester: { receivedConnections: { some: { fromUserId: user.id, status: 'accepted' } } } },
              ],
              requesterId: { not: user.id },
            },
          }),
          // Pending actions
          prisma.introRequest.count({
            where: {
              status: 'open',
              offers: { none: { introducerId: user.id } },
              OR: [
                { space: { members: { some: { userId: user.id, status: 'approved' } } } },
                { requester: { sentConnections: { some: { toUserId: user.id, status: 'accepted' } } } },
                { requester: { receivedConnections: { some: { fromUserId: user.id, status: 'accepted' } } } },
              ],
              requesterId: { not: user.id },
            },
          }),
          prisma.introOffer.count({
            where: { request: { requesterId: user.id }, status: 'pending' },
          }),
          prisma.directConnection.count({
            where: { toUserId: user.id, status: 'pending' },
          }),
          // Top companies
          prisma.contact.groupBy({
            by: ['companyId'],
            where: { userId: user.id, createdAt: { gte: oneWeekAgo }, companyId: { not: null } },
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 5,
          }),
        ]);

        const totalActions = pendingRequestsForYou + pendingOffersForYou + unansweredConnectionRequests;
        if (newContacts === 0 && newMeetings === 0 && introsSent === 0 && introsReceived === 0 && introsDone === 0 && totalActions === 0) {
          continue;
        }

        const companyIds = topCompanies.map(tc => tc.companyId).filter(Boolean) as string[];
        const companies = companyIds.length > 0
          ? await prisma.company.findMany({
              where: { id: { in: companyIds } },
              select: { id: true, name: true, logo: true },
            })
          : [];

        const topCompanyList = topCompanies.map(tc => {
          const company = companies.find(c => c.id === tc.companyId);
          return { name: company?.name || 'Unknown', logo: company?.logo, contactCount: tc._count.id };
        });

        // Generate insight line based on the most interesting stat
        let insight: string | undefined;
        const topCompany = topCompanyList[0];
        if (topCompany && topCompany.contactCount >= 3) {
          insight = `Your <strong>${topCompany.name}</strong> network grew by ${topCompany.contactCount} contacts this week.`;
        } else if (introsDone > 0) {
          insight = `${introsDone} warm intro${introsDone !== 1 ? 's' : ''} made this week — connections that skip the cold outreach.`;
        } else if (newContacts > prevContacts && prevContacts > 0) {
          const pct = Math.round(((newContacts - prevContacts) / prevContacts) * 100);
          if (pct >= 20) insight = `Your contact growth is up ${pct}% compared to last week. Keep it going.`;
        }

        await sendWeeklyDigest(user.id, {
          newContacts, newMeetings, introsSent, introsReceived, introsDone,
          prevContacts, prevMeetings, prevIntrosSent: prevIntrosSent, prevIntrosReceived: prevIntrosReceived,
          topCompanies: topCompanyList,
          actionItems: { pendingRequestsForYou, pendingOffersForYou, unansweredConnectionRequests },
          insight,
        });

        await prisma.user.update({
          where: { id: user.id },
          data: { lastDigestDate: todayStr },
        });

        console.log(`[cron] Sent weekly digest to ${user.email}`);
      } catch (err) {
        console.error(`[cron] Failed to send digest to ${user.email}:`, (err as Error).message);
      }
    }

    console.log('[cron] Weekly digest complete');
  } catch (err) {
    console.error('[cron] Weekly digest error:', err);
  }
}

// ─── Daily morning briefing (9 AM per user timezone) ─────────────────────────

const BRIEFING_CHECK_INTERVAL_MS = 15 * 60 * 1000; // check every 15 minutes

let briefingRunning = false;

async function dailyMorningBriefing() {
  if (briefingRunning) {
    console.log('[cron] Skipping briefing check — previous run still in progress');
    return;
  }
  briefingRunning = true;
  console.log('[cron] Checking daily briefing eligibility...');
  try {
    const users = await prisma.user.findMany({
      where: { googleAccessToken: { not: null } },
      select: { id: true, email: true, timezone: true, lastBriefingDate: true },
    });

    for (const user of users) {
      try {
        const tz = user.timezone || 'UTC';
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: 'numeric', hour12: false, weekday: 'short',
        }).formatToParts(now);
        const get = (type: string) => parts.find(p => p.type === type)?.value || '';
        const hour = parseInt(get('hour'), 10);
        const dayName = get('weekday');
        const todayStr = `${get('year')}-${get('month')}-${get('day')}`; // YYYY-MM-DD
        const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayName);

        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        // Only send between 9:00–9:14 (within the 15-min check window)
        if (hour !== 9) continue;

        // Already sent today
        if (user.lastBriefingDate === todayStr) continue;

        console.log(`[cron] Generating briefing for ${user.email} (tz: ${tz})`);

        const events = await getTodayEvents(user.id, tz);
        if (events.length === 0) {
          // No meetings — mark as sent so we don't re-check
          await prisma.user.update({ where: { id: user.id }, data: { lastBriefingDate: todayStr } });
          console.log(`[cron] No meetings today for ${user.email}, skipping email`);
          continue;
        }

        // Ensure contacts exist for all attendees
        const allEmails = events.flatMap(e => e.attendees.map(a => a.email));
        const attendeeInfo = await ensureContactsForBriefing(user.id, allEmails);

        // Build briefing meetings with enriched attendee data
        const briefingMeetings: BriefingMeeting[] = events.map(e => ({
          title: e.title,
          startTime: e.startTime,
          endTime: e.endTime,
          duration: e.duration,
          attendees: e.attendees.map(a => {
            const info = attendeeInfo.get(a.email);
            return {
              name: info?.name || a.name || a.email.split('@')[0],
              title: info?.title || null,
              linkedinUrl: info?.linkedinUrl || null,
              companyName: info?.companyName || null,
              companyDomain: info?.companyDomain || null,
              companyIndustry: info?.companyIndustry || null,
              companyEmployees: info?.companyEmployees || null,
              companyFunding: info?.companyFunding || null,
              companyLinkedinUrl: info?.companyLinkedinUrl || null,
              meetingsCount: info?.meetingsCount || 0,
              strength: info?.strength || 'none',
              isInternal: info?.isInternal || false,
            } satisfies BriefingAttendee;
          }),
        }));

        await sendDailyBriefing(user.id, briefingMeetings, tz);
        await prisma.user.update({ where: { id: user.id }, data: { lastBriefingDate: todayStr } });
        console.log(`[cron] Sent daily briefing to ${user.email} (${events.length} meetings)`);
      } catch (err) {
        console.error(`[cron] Failed briefing for ${user.email}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[cron] Daily briefing error:', err);
  } finally {
    briefingRunning = false;
  }
}

// ─── Calendar connection reminders (30min, 1day, 3days after signup) ─────────

const REMINDER_CHECK_INTERVAL_MS = 10 * 60 * 1000; // check every 10 minutes

const REMINDER_THRESHOLDS: { ping: 1 | 2 | 3; minMs: number; maxMs: number }[] = [
  { ping: 1, minMs: 30 * 60 * 1000, maxMs: 24 * 60 * 60 * 1000 },           // 30 min – 24h
  { ping: 2, minMs: 24 * 60 * 60 * 1000, maxMs: 3 * 24 * 60 * 60 * 1000 },  // 1 day – 3 days
  { ping: 3, minMs: 3 * 24 * 60 * 60 * 1000, maxMs: 7 * 24 * 60 * 60 * 1000 }, // 3 days – 7 days
];

let reminderRunning = false;

async function backgroundCalendarReminders() {
  if (reminderRunning) return;
  reminderRunning = true;
  try {
    const users = await prisma.user.findMany({
      where: {
        googleAccessToken: null,
        calendarRemindersSent: { lt: 3 },
      },
      select: { id: true, email: true, name: true, createdAt: true, calendarRemindersSent: true },
    });

    const now = Date.now();

    for (const user of users) {
      try {
        const ageMs = now - new Date(user.createdAt).getTime();
        let currentSent = user.calendarRemindersSent;

        // Skip past any ping windows that have already closed
        while (currentSent < 3) {
          const nextPing = (currentSent + 1) as 1 | 2 | 3;
          const threshold = REMINDER_THRESHOLDS.find(t => t.ping === nextPing);
          if (!threshold) break;
          if (ageMs < threshold.minMs) break; // too early for this ping
          if (ageMs < threshold.maxMs) {
            // Within window — send this ping
            await sendCalendarReminderEmail({ id: user.id, email: user.email, name: user.name }, nextPing);
            await prisma.user.update({
              where: { id: user.id },
              data: { calendarRemindersSent: nextPing },
            });
            console.log(`[cron] Sent calendar reminder #${nextPing} to ${user.email}`);
            break;
          }
          // Window has passed — skip this ping silently
          currentSent = nextPing;
          await prisma.user.update({
            where: { id: user.id },
            data: { calendarRemindersSent: nextPing },
          });
          console.log(`[cron] Skipped calendar reminder #${nextPing} for ${user.email} (window passed)`);
        }
      } catch (err) {
        console.error(`[cron] Failed calendar reminder for ${user.email}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[cron] Calendar reminders error:', err);
  } finally {
    reminderRunning = false;
  }
}

// ─── Invite signup reminders (1d, 3d, 7d, 10d after invite) ─────────────────

const INVITE_REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000; // check every hour

const INVITE_REMINDER_THRESHOLDS: { ping: 1 | 2 | 3 | 4; minMs: number; maxMs: number }[] = [
  { ping: 1, minMs: 1 * 24 * 60 * 60 * 1000, maxMs: 3 * 24 * 60 * 60 * 1000 },
  { ping: 2, minMs: 3 * 24 * 60 * 60 * 1000, maxMs: 7 * 24 * 60 * 60 * 1000 },
  { ping: 3, minMs: 7 * 24 * 60 * 60 * 1000, maxMs: 10 * 24 * 60 * 60 * 1000 },
  { ping: 4, minMs: 10 * 24 * 60 * 60 * 1000, maxMs: 30 * 24 * 60 * 60 * 1000 },
];

let inviteReminderRunning = false;

async function backgroundInviteReminders() {
  if (inviteReminderRunning) return;
  inviteReminderRunning = true;
  try {
    const invites = await prisma.pendingInvite.findMany({
      where: {
        status: 'pending',
        remindersSent: { lt: 4 },
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        remindersSent: true,
        spaceId: true,
        fromUser: { select: { name: true } },
        space: { select: { name: true, emoji: true } },
      },
    });

    const now = Date.now();

    // Deduplicate: one active reminder track per email+type (1:1 vs each space)
    // This ensures a space invite doesn't get starved by an older 1:1 invite
    const seenKeys = new Set<string>();
    const dedupedInvites = invites
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .filter(inv => {
        const key = `${inv.email.toLowerCase()}:${inv.spaceId || '1:1'}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

    for (const invite of dedupedInvites) {
      try {
        // Skip if the user has since signed up
        const existingUser = await prisma.user.findUnique({
          where: { email: invite.email },
          select: { id: true },
        });
        if (existingUser) continue;

        const ageMs = now - new Date(invite.createdAt).getTime();
        let currentSent = invite.remindersSent;

        // Skip past any ping windows that have already closed
        while (currentSent < 4) {
          const nextPing = (currentSent + 1) as 1 | 2 | 3 | 4;
          const threshold = INVITE_REMINDER_THRESHOLDS.find(t => t.ping === nextPing);
          if (!threshold) break;
          if (ageMs < threshold.minMs) break; // too early for this ping
          if (ageMs < threshold.maxMs) {
            // Within window — send this ping
            const senderName = invite.fromUser?.name || 'Someone';

            if (invite.spaceId && invite.space) {
              await sendSpaceInviteReminderEmail({
                recipientEmail: invite.email,
                senderName,
                spaceName: invite.space.name,
                spaceEmoji: invite.space.emoji || '',
                ping: nextPing,
              });
            } else {
              await sendInviteReminderEmail({
                recipientEmail: invite.email,
                senderName,
                ping: nextPing,
              });
            }

            await prisma.pendingInvite.update({
              where: { id: invite.id },
              data: { remindersSent: nextPing },
            });
            console.log(`[cron] Sent invite reminder #${nextPing} to ${invite.email}`);
            break;
          }
          // Window has passed — skip this ping silently
          currentSent = nextPing;
          await prisma.pendingInvite.update({
            where: { id: invite.id },
            data: { remindersSent: nextPing },
          });
          console.log(`[cron] Skipped invite reminder #${nextPing} for ${invite.email} (window passed)`);
        }
      } catch (err) {
        console.error(`[cron] Failed invite reminder for ${invite.email}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[cron] Invite reminders error:', err);
  } finally {
    inviteReminderRunning = false;
  }
}

// ─── Connection acceptance reminders (1d, 3d, 7d — gated behind calendar) ────

const CONN_REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000; // check every hour

const CONN_REMINDER_THRESHOLDS: { ping: 1 | 2 | 3; minMs: number; maxMs: number }[] = [
  { ping: 1, minMs: 1 * 24 * 60 * 60 * 1000, maxMs: 3 * 24 * 60 * 60 * 1000 },
  { ping: 2, minMs: 3 * 24 * 60 * 60 * 1000, maxMs: 7 * 24 * 60 * 60 * 1000 },
  { ping: 3, minMs: 7 * 24 * 60 * 60 * 1000, maxMs: 14 * 24 * 60 * 60 * 1000 },
];

let connReminderRunning = false;

async function backgroundConnectionReminders() {
  if (connReminderRunning) return;
  connReminderRunning = true;
  try {
    const pendingConns = await prisma.directConnection.findMany({
      where: {
        status: 'pending',
        remindersSent: { lt: 3 },
      },
      select: {
        id: true,
        createdAt: true,
        remindersSent: true,
        toUserId: true,
        fromUser: { select: { name: true } },
        toUser: { select: { id: true, name: true, email: true, googleAccessToken: true, calendarConnectedAt: true, emailPreferences: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const now = Date.now();

    // Only process the FIRST pending connection per recipient
    const seenRecipients = new Set<string>();
    const firstConns = pendingConns.filter(conn => {
      if (seenRecipients.has(conn.toUserId)) return false;
      seenRecipients.add(conn.toUserId);
      return true;
    });

    for (const conn of firstConns) {
      try {
        const { toUser } = conn;

        // Skip if there's an older pending connection for this user (only remind about the oldest pending one)
        const hasEarlierPendingConnection = await prisma.directConnection.count({
          where: {
            toUserId: conn.toUserId,
            status: 'pending',
            createdAt: { lt: conn.createdAt },
          },
        });
        if (hasEarlierPendingConnection > 0) continue;

        // Gate: calendar must be connected
        if (!toUser.googleAccessToken && !toUser.calendarConnectedAt) continue;

        // Respect email preferences
        if (toUser.emailPreferences && typeof toUser.emailPreferences === 'object') {
          const prefs = toUser.emailPreferences as Record<string, boolean>;
          if (prefs.notifications === false) continue;
        }

        // Sequence starts from whichever is later: invite creation or calendar connection
        const calConnAt = toUser.calendarConnectedAt ? new Date(toUser.calendarConnectedAt).getTime() : 0;
        const inviteAt = new Date(conn.createdAt).getTime();
        const sequenceStart = Math.max(inviteAt, calConnAt);
        const ageMs = now - sequenceStart;

        let currentSent = conn.remindersSent;

        while (currentSent < 3) {
          const nextPing = (currentSent + 1) as 1 | 2 | 3;
          const threshold = CONN_REMINDER_THRESHOLDS.find(t => t.ping === nextPing);
          if (!threshold) break;
          if (ageMs < threshold.minMs) break;
          if (ageMs < threshold.maxMs) {
            await sendConnectionReminderEmail({
              recipientEmail: toUser.email,
              recipientName: toUser.name,
              senderName: conn.fromUser?.name || 'Someone',
              ping: nextPing,
            });
            await prisma.directConnection.update({
              where: { id: conn.id },
              data: { remindersSent: nextPing },
            });
            console.log(`[cron] Sent connection reminder #${nextPing} to ${toUser.email} (from ${conn.fromUser?.name})`);
            break;
          }
          currentSent = nextPing;
          await prisma.directConnection.update({
            where: { id: conn.id },
            data: { remindersSent: nextPing },
          });
          console.log(`[cron] Skipped connection reminder #${nextPing} for ${toUser.email} (window passed)`);
        }
      } catch (err) {
        console.error(`[cron] Failed connection reminder for conn ${conn.id}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[cron] Connection reminders error:', err);
  } finally {
    connReminderRunning = false;
  }
}

// ─── Intro nudge reminders (1d, 3d, 7d — for connected users with 0 intro requests) ─

const INTRO_NUDGE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // check every hour

const INTRO_NUDGE_THRESHOLDS: { ping: 1 | 2 | 3; minMs: number; maxMs: number }[] = [
  { ping: 1, minMs: 1 * 24 * 60 * 60 * 1000, maxMs: 3 * 24 * 60 * 60 * 1000 },
  { ping: 2, minMs: 3 * 24 * 60 * 60 * 1000, maxMs: 7 * 24 * 60 * 60 * 1000 },
  { ping: 3, minMs: 7 * 24 * 60 * 60 * 1000, maxMs: 14 * 24 * 60 * 60 * 1000 },
];

let introNudgeRunning = false;

async function backgroundIntroNudgeReminders() {
  if (introNudgeRunning) return;
  introNudgeRunning = true;
  try {
    // Users who have calendar connected, haven't maxed out nudges, and have 0 intro requests
    const candidates = await prisma.user.findMany({
      where: {
        googleAccessToken: { not: null },
        introRemindersSent: { lt: 3 },
        introRequests: { none: {} },
      },
      select: {
        id: true,
        email: true,
        name: true,
        introRemindersSent: true,
        introNudgeStartAt: true,
        emailPreferences: true,
        // First accepted 1:1 connection (as recipient)
        receivedConnections: {
          where: { status: 'accepted' },
          orderBy: { updatedAt: 'asc' },
          take: 1,
          select: { updatedAt: true },
        },
        // First accepted 1:1 connection (as sender)
        sentConnections: {
          where: { status: 'accepted' },
          orderBy: { updatedAt: 'asc' },
          take: 1,
          select: { updatedAt: true },
        },
        // First approved space membership
        spaceMemberships: {
          where: { status: 'approved' },
          orderBy: { joinedAt: 'asc' },
          take: 1,
          select: { joinedAt: true },
        },
        // Check if this is their first-ever connection/space (for "first only" rule)
        _count: {
          select: {
            receivedConnections: { where: { status: 'accepted' } },
            sentConnections: { where: { status: 'accepted' } },
            spaceMemberships: { where: { status: 'approved' } },
          },
        },
      },
    });

    const now = Date.now();

    for (const user of candidates) {
      try {
        // Must have at least one accepted connection (sent or received) or approved space
        const firstReceivedAt = user.receivedConnections[0]?.updatedAt;
        const firstSentAt = user.sentConnections[0]?.updatedAt;
        const firstConnAt = firstReceivedAt && firstSentAt
          ? (new Date(firstReceivedAt).getTime() < new Date(firstSentAt).getTime() ? firstReceivedAt : firstSentAt)
          : firstReceivedAt || firstSentAt;
        const firstSpaceAt = user.spaceMemberships[0]?.joinedAt;
        if (!firstConnAt && !firstSpaceAt) continue;

        // Only for the first connection/space: total count must be exactly 1
        const totalConnections = user._count.receivedConnections + user._count.sentConnections + user._count.spaceMemberships;
        // Stricter: only start the sequence if they have exactly 1 total
        if (user.introRemindersSent === 0 && totalConnections > 1) continue;

        // Respect email preferences
        if (user.emailPreferences && typeof user.emailPreferences === 'object') {
          const prefs = user.emailPreferences as Record<string, boolean>;
          if (prefs.notifications === false) continue;
        }

        // Sequence starts from the earliest accepted connection or approved space,
        // but never earlier than introNudgeStartAt (backfill override for existing users)
        const connTs = firstConnAt ? new Date(firstConnAt).getTime() : Infinity;
        const spaceTs = firstSpaceAt ? new Date(firstSpaceAt).getTime() : Infinity;
        const computedStart = Math.min(connTs, spaceTs);
        const overrideStart = user.introNudgeStartAt ? new Date(user.introNudgeStartAt).getTime() : 0;
        const sequenceStart = Math.max(computedStart, overrideStart);
        const ageMs = now - sequenceStart;

        let currentSent = user.introRemindersSent;

        while (currentSent < 3) {
          const nextPing = (currentSent + 1) as 1 | 2 | 3;
          const threshold = INTRO_NUDGE_THRESHOLDS.find(t => t.ping === nextPing);
          if (!threshold) break;
          if (ageMs < threshold.minMs) break;
          if (ageMs < threshold.maxMs) {
            await sendIntroNudgeEmail({ email: user.email, name: user.name }, nextPing);
            await prisma.user.update({
              where: { id: user.id },
              data: { introRemindersSent: nextPing },
            });
            console.log(`[cron] Sent intro nudge #${nextPing} to ${user.email}`);
            break;
          }
          currentSent = nextPing;
          await prisma.user.update({
            where: { id: user.id },
            data: { introRemindersSent: nextPing },
          });
          console.log(`[cron] Skipped intro nudge #${nextPing} for ${user.email} (window passed)`);
        }
      } catch (err) {
        console.error(`[cron] Failed intro nudge for ${user.email}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[cron] Intro nudge reminders error:', err);
  } finally {
    introNudgeRunning = false;
  }
}

// Ensure ADMIN_EMAILS users have admin role on startup
async function ensureAdminUsers() {
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) return;

  for (const email of adminEmails) {
    try {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
      if (user && user.role !== 'admin') {
        await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } });
        console.log(`[admin] Promoted ${email} to admin`);
      }
    } catch (err) {
      console.error(`[admin] Failed to promote ${email}:`, (err as Error).message);
    }
  }
}

// One-time backfill: set calendarConnectedAt for existing users so connection
// reminder sequence starts fresh (first email at ~9 AM CET next morning).
// Idempotent — only touches users where the field is still NULL.
async function backfillCalendarConnectedAt() {
  try {
    // Target: 9 AM CET tomorrow = 08:00 UTC tomorrow
    // Set calendarConnectedAt to 08:00 UTC today so 24h later = 9 AM CET tomorrow
    const tomorrow9amCET = new Date();
    tomorrow9amCET.setUTCHours(8, 0, 0, 0);
    // If it's already past 8 AM UTC today, target tomorrow
    if (tomorrow9amCET.getTime() <= Date.now()) {
      tomorrow9amCET.setUTCDate(tomorrow9amCET.getUTCDate() + 1);
    }
    const backfillTimestamp = new Date(tomorrow9amCET.getTime() - 24 * 60 * 60 * 1000);

    const result = await prisma.user.updateMany({
      where: {
        googleAccessToken: { not: null },
        calendarConnectedAt: null,
      },
      data: {
        calendarConnectedAt: backfillTimestamp,
      },
    });

    if (result.count > 0) {
      console.log(`[backfill] Set calendarConnectedAt for ${result.count} existing user(s) → first connection reminder at ~9 AM CET`);
    }
  } catch (err) {
    console.error('[backfill] calendarConnectedAt backfill error:', (err as Error).message);
  }
}

// One-time backfill: set introNudgeStartAt for existing users who have accepted
// a connection or joined a space but haven't requested an intro yet.
// Sets the override so the first intro nudge email fires Monday 9 AM CET.
// Idempotent — only touches users where introNudgeStartAt is still NULL
// and introRemindersSent is 0.
async function backfillIntroNudgeStart() {
  try {
    // Monday March 2 2026, 9 AM CET = 08:00 UTC
    // First email fires 1 day after introNudgeStartAt, so set to Sunday March 1 08:00 UTC
    const monday9amCET = new Date('2026-03-02T08:00:00.000Z');
    const backfillTimestamp = new Date(monday9amCET.getTime() - 24 * 60 * 60 * 1000);

    // Only backfill if Monday hasn't passed yet
    if (Date.now() > monday9amCET.getTime()) {
      console.log('[backfill] introNudgeStartAt: Monday 9 AM CET has passed, skipping');
      return;
    }

    const result = await prisma.user.updateMany({
      where: {
        googleAccessToken: { not: null },
        introRemindersSent: 0,
        introNudgeStartAt: null,
        introRequests: { none: {} },
        OR: [
          { receivedConnections: { some: { status: 'accepted' } } },
          { spaceMemberships: { some: { status: 'approved' } } },
        ],
      },
      data: {
        introNudgeStartAt: backfillTimestamp,
      },
    });

    if (result.count > 0) {
      console.log(`[backfill] Set introNudgeStartAt for ${result.count} existing user(s) → first intro nudge at Monday 9 AM CET`);
    }
  } catch (err) {
    console.error('[backfill] introNudgeStartAt backfill error:', (err as Error).message);
  }
}

// Start server
verifyDatabaseConnection().then(async () => {
  await ensureAdminUsers();
  await backfillCalendarConnectedAt();
  await backfillIntroNudgeStart();
  server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);

    // Run initial sync after a short delay to let the server stabilize
    setTimeout(backgroundCalendarSync, 30 * 1000);
    setInterval(backgroundCalendarSync, SYNC_INTERVAL_MS);
    console.log(`[cron] Calendar background sync scheduled every ${SYNC_INTERVAL_MS / 3600000}h (initial run in 30s)`);

    setTimeout(backgroundWeeklyDigest, 10 * 60 * 1000); // initial run 10 min after startup
    setInterval(backgroundWeeklyDigest, DIGEST_INTERVAL_MS);
    console.log(`[cron] Weekly digest email scheduled every 7 days (initial run in 10m)`);

    setTimeout(dailyMorningBriefing, 60 * 1000); // initial check 1 min after startup
    setInterval(dailyMorningBriefing, BRIEFING_CHECK_INTERVAL_MS);
    console.log(`[cron] Daily briefing check scheduled every 15 minutes (initial run in 60s)`);

    setTimeout(backgroundCalendarReminders, 2 * 60 * 1000); // initial check 2 min after startup
    setInterval(backgroundCalendarReminders, REMINDER_CHECK_INTERVAL_MS);
    console.log(`[cron] Calendar connection reminders scheduled every 10 minutes (initial run in 2m)`);

    setTimeout(backgroundInviteReminders, 3 * 60 * 1000); // initial check 3 min after startup
    setInterval(backgroundInviteReminders, INVITE_REMINDER_CHECK_INTERVAL_MS);
    console.log(`[cron] Invite signup reminders scheduled every 1 hour (initial run in 3m)`);

    setTimeout(backgroundConnectionReminders, 4 * 60 * 1000); // initial check 4 min after startup
    setInterval(backgroundConnectionReminders, CONN_REMINDER_CHECK_INTERVAL_MS);
    console.log(`[cron] Connection acceptance reminders scheduled every 1 hour (initial run in 4m)`);

    setTimeout(backgroundIntroNudgeReminders, 5 * 60 * 1000); // initial check 5 min after startup
    setInterval(backgroundIntroNudgeReminders, INTRO_NUDGE_CHECK_INTERVAL_MS);
    console.log(`[cron] Intro nudge reminders scheduled every 1 hour (initial run in 5m)`);
  });
});
