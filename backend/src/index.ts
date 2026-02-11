import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import rateLimit from 'express-rate-limit';

import { configurePassport } from './middleware/auth.js';
import { securityHeaders, httpsRedirect } from './middleware/security.js';
import authRoutes from './routes/auth.js';
import calendarRoutes from './routes/calendar.js';
import usersRoutes from './routes/users.js';
import requestsRoutes from './routes/requests.js';
import offersRoutes from './routes/offers.js';
import relationshipsRoutes from './routes/relationships.js';
import spacesRoutes from './routes/spaces.js';
import signalsRoutes from './routes/signals.js';
import prisma from './lib/prisma.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Environment variable validation
const requiredEnvVars = ['DATABASE_URL'];
const recommendedEnvVars = ['JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FRONTEND_URL'];

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

// Start server
verifyDatabaseConnection().then(() => {
  server = app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
});
