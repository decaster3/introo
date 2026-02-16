import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import rateLimit from 'express-rate-limit';

import { configurePassport } from './middleware/auth.js';
import { securityHeaders, httpsRedirect } from './middleware/security.js';
import { syncCalendarForUser, syncCalendarAccount } from './services/calendar.js';
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
import { sendWeeklyDigest } from './services/email.js';
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

// Middleware
// Security headers first
app.use(securityHeaders);

// HTTPS redirect in production
if (isProduction) {
  app.use(httpsRedirect);
}

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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

// Health check with database connectivity
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

async function backgroundCalendarSync() {
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
        runEnrichmentForUser(u.id);
        console.log(`[cron] Queued enrichment for ${u.email}`);
      } catch (err) {
        console.error(`[cron] Failed to queue enrichment for ${u.email}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error('[cron] Background sync error:', err);
  }
}

// ─── Weekly digest email (every 7 days) ──────────────────────────────────────

const DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

        // Skip users with no activity
        if (newContacts === 0 && newMeetings === 0 && introRequests === 0 && introOffers === 0) {
          continue;
        }

        // Resolve company names for top companies
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

// Start server
verifyDatabaseConnection().then(() => {
  server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);

    // Start background sync interval
    setInterval(backgroundCalendarSync, SYNC_INTERVAL_MS);
    console.log(`[cron] Calendar background sync scheduled every ${SYNC_INTERVAL_MS / 3600000}h`);

    // Start weekly digest interval
    setInterval(backgroundWeeklyDigest, DIGEST_INTERVAL_MS);
    console.log(`[cron] Weekly digest email scheduled every 7 days`);
  });
});
