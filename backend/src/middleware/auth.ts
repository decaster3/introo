import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import prisma from '../lib/prisma.js';

// Security: Require JWT_SECRET in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET environment variable is required in production');
  }
  console.warn('WARNING: JWT_SECRET not set, using insecure default for development only');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-secret-do-not-use-in-prod';
const JWT_EXPIRES_IN = '7d';

// Token encryption for OAuth tokens at rest
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: ENCRYPTION_KEY environment variable is required in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  console.warn('WARNING: ENCRYPTION_KEY not set. Using insecure default for development only. OAuth tokens will be lost on restart.');
}
const EFFECTIVE_ENCRYPTION_KEY = ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(EFFECTIVE_ENCRYPTION_KEY.slice(0, 64), 'hex');
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptToken(encryptedToken: string): string | null {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedToken.split(':');
    if (!ivHex || !authTagHex || !encrypted) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(EFFECTIVE_ENCRYPTION_KEY.slice(0, 64), 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

export interface JwtPayload {
  userId: string;
  email: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  title?: string | null;
  company?: string | null;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
  headline?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function configurePassport() {
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback';
  console.log('Configuring Passport with callbackURL:', callbackURL);
  
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        callbackURL,
        scope: [
          'profile',
          'email',
          'https://www.googleapis.com/auth/calendar.readonly',
        ],
        accessType: 'offline',
        prompt: 'select_account',
      } as any,
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('No email found in Google profile'));
          }

          // Encrypt tokens before storing
          const encryptedAccessToken = encryptToken(accessToken);
          const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : undefined;

          // Upsert user
          const user = await prisma.user.upsert({
            where: { email },
            update: {
              name: profile.displayName,
              avatar: profile.photos?.[0]?.value,
              googleAccessToken: encryptedAccessToken,
              googleRefreshToken: encryptedRefreshToken,
            },
            create: {
              email,
              name: profile.displayName,
              avatar: profile.photos?.[0]?.value,
              googleAccessToken: encryptedAccessToken,
              googleRefreshToken: encryptedRefreshToken,
            },
          });

          // Also write tokens to CalendarAccount (single source of truth for sync)
          await prisma.calendarAccount.upsert({
            where: { userId_email: { userId: user.id, email } },
            update: {
              googleAccessToken: encryptedAccessToken,
              googleRefreshToken: encryptedRefreshToken,
              isActive: true,
            },
            create: {
              userId: user.id,
              email,
              googleAccessToken: encryptedAccessToken,
              googleRefreshToken: encryptedRefreshToken,
            },
          });

          // Convert pending invites into real connections / space memberships
          try {
            const pendingInvites = await prisma.pendingInvite.findMany({
              where: { email: email.toLowerCase(), status: 'pending' },
              include: {
                fromUser: { select: { id: true, name: true } },
                space: { select: { id: true, name: true, emoji: true } },
              },
            });
            for (const invite of pendingInvites) {
              if (invite.spaceId && invite.space) {
                // Space invite → create pending SpaceMember + notify
                const existingMember = await prisma.spaceMember.findUnique({
                  where: { spaceId_userId: { spaceId: invite.spaceId, userId: user.id } },
                });
                if (!existingMember) {
                  await prisma.spaceMember.create({
                    data: { spaceId: invite.spaceId, userId: user.id, role: 'member', status: 'pending' },
                  });
                  await prisma.notification.create({
                    data: {
                      userId: user.id,
                      type: 'space_invited',
                      title: `Invitation to ${invite.space.name}`,
                      body: `${invite.fromUser.name || 'Someone'} invited you to join ${invite.space.emoji || ''} ${invite.space.name}.`,
                      data: { spaceId: invite.spaceId, spaceName: invite.space.name, spaceEmoji: invite.space.emoji, inviterId: invite.fromUserId },
                    },
                  });
                }
              } else {
                // 1:1 connection invite → create DirectConnection + notify
                const existing = await prisma.directConnection.findFirst({
                  where: {
                    OR: [
                      { fromUserId: invite.fromUserId, toUserId: user.id },
                      { fromUserId: user.id, toUserId: invite.fromUserId },
                    ],
                  },
                });
                if (!existing) {
                  const conn = await prisma.directConnection.create({
                    data: { fromUserId: invite.fromUserId, toUserId: user.id },
                  });
                  await prisma.notification.create({
                    data: {
                      userId: user.id,
                      type: 'connection_request',
                      title: `${invite.fromUser.name || 'Someone'} wants to connect`,
                      body: 'They invited you to join. Accept to share your networks with each other.',
                      data: { connectionId: conn.id, fromUserId: invite.fromUserId, fromUserName: invite.fromUser.name },
                    },
                  });
                }
              }
              // Mark invite as converted
              await prisma.pendingInvite.update({
                where: { id: invite.id },
                data: { status: 'converted' },
              });
            }
            if (pendingInvites.length > 0) {
              console.log(`[auth] Converted ${pendingInvites.length} pending invite(s) for ${email}`);
            }
          } catch (err) {
            console.error('[auth] Failed to convert pending invites:', err);
          }

          return done(null, user);
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      done(null, user);
    } catch (error) {
      done(error);
    }
  });
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, EFFECTIVE_JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// In-memory user cache to avoid DB hit on every authenticated request
const USER_CACHE = new Map<string, { user: AuthUser; expiry: number }>();
const USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function invalidateUserCache(userId: string) {
  USER_CACHE.delete(userId);
}

const USER_SELECT = { id: true, email: true, name: true, avatar: true, title: true, company: true, companyDomain: true, linkedinUrl: true, headline: true, city: true, country: true } as const;

export const authMiddleware: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    // Check cache first
    const cached = USER_CACHE.get(payload.userId);
    if (cached && cached.expiry > Date.now()) {
      (req as AuthenticatedRequest).user = cached.user;
      next();
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: USER_SELECT,
    });

    if (!user) {
      USER_CACHE.delete(payload.userId);
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Cache the user
    USER_CACHE.set(payload.userId, { user, expiry: Date.now() + USER_CACHE_TTL });

    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication error' });
  }
};

export const optionalAuthMiddleware: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
          select: { id: true, email: true, name: true, avatar: true, title: true, company: true, companyDomain: true, linkedinUrl: true, headline: true, city: true, country: true },
        });
        if (user) {
          (req as AuthenticatedRequest).user = user;
        }
      } catch {
        // Ignore errors for optional auth
      }
    }
  }

  next();
};
