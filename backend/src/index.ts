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
import { sendWeeklyDigest, sendDailyBriefing } from './services/email.js';
import type { BriefingMeeting, BriefingAttendee } from './services/email.js';
import prisma from './lib/prisma.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Environment variable validation
const requiredEnvVars = ['DATABASE_URL'];
const recommendedEnvVars = ['JWT_SECRET', 'ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FRONTEND_URL', 'APOLLO_API_KEY', 'OPENAI_API_KEY', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'];

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
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const users = await prisma.user.findMany({
      where: { googleAccessToken: { not: null } },
      select: { id: true, email: true },
    });

    for (const user of users) {
      try {
        const [newContacts, newMeetings, introRequests, introOffers, topCompanies] = await Promise.all([
          prisma.contact.count({
            where: { userId: user.id, createdAt: { gte: oneWeekAgo } },
          }),
          prisma.meeting.count({
            where: { contact: { userId: user.id }, date: { gte: oneWeekAgo } },
          }),
          prisma.introRequest.count({
            where: { requesterId: user.id, createdAt: { gte: oneWeekAgo } },
          }),
          prisma.introOffer.count({
            where: { introducerId: user.id, createdAt: { gte: oneWeekAgo } },
          }),
          prisma.contact.groupBy({
            by: ['companyId'],
            where: { userId: user.id, createdAt: { gte: oneWeekAgo }, companyId: { not: null } },
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 5,
          }),
        ]);

        if (newContacts === 0 && newMeetings === 0 && introRequests === 0 && introOffers === 0) {
          continue;
        }

        const companyIds = topCompanies.map(tc => tc.companyId).filter(Boolean) as string[];
        const companies = companyIds.length > 0
          ? await prisma.company.findMany({
              where: { id: { in: companyIds } },
              select: { id: true, name: true },
            })
          : [];

        const topCompanyList = topCompanies.map(tc => {
          const company = companies.find(c => c.id === tc.companyId);
          return { name: company?.name || 'Unknown', contactCount: tc._count.id };
        });

        await sendWeeklyDigest(user.id, {
          newContacts,
          newMeetings,
          introRequests,
          introOffers,
          topCompanies: topCompanyList,
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

// Start server
verifyDatabaseConnection().then(() => {
  server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);

    // Run initial sync after a short delay to let the server stabilize
    setTimeout(backgroundCalendarSync, 30 * 1000);
    setInterval(backgroundCalendarSync, SYNC_INTERVAL_MS);
    console.log(`[cron] Calendar background sync scheduled every ${SYNC_INTERVAL_MS / 3600000}h (initial run in 30s)`);

    setInterval(backgroundWeeklyDigest, DIGEST_INTERVAL_MS);
    console.log(`[cron] Weekly digest email scheduled every 7 days`);

    setTimeout(dailyMorningBriefing, 60 * 1000); // initial check 1 min after startup
    setInterval(dailyMorningBriefing, BRIEFING_CHECK_INTERVAL_MS);
    console.log(`[cron] Daily briefing check scheduled every 15 minutes (initial run in 60s)`);
  });
});
