import { Router } from 'express';
import passport from 'passport';
import { google } from 'googleapis';
import { generateToken, verifyToken, authMiddleware, encryptToken, invalidateUserCache, AuthenticatedRequest } from '../middleware/auth.js';
import { cookieConfig } from '../middleware/security.js';
import { sendWelcomeEmail } from '../services/email.js';
import prisma from '../lib/prisma.js';
import { enrichUserProfile } from '../services/apollo.js';

const router = Router();

const ADD_ACCOUNT_PREFIX = 'add_account:';

function getCallbackUrl() {
  return process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback';
}

function buildOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || '',
    process.env.GOOGLE_CLIENT_SECRET || '',
    getCallbackUrl(),
  );
}

// Initiate Google OAuth (login)
router.get('/google', (req, res, next) => {
  console.log('Initiating OAuth, GOOGLE_CALLBACK_URL:', getCallbackUrl());
  
  passport.authenticate('google', {
    accessType: 'offline',
    prompt: 'consent',
  } as any)(req, res, next);
});

// ─── Add Google Account (link additional calendar to current user) ───────────
// Uses the SAME callback URL as login, but passes state=add_account:<userId>

router.get('/google/add-account', (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  // Must already be logged in
  const token = req.cookies?.token;
  if (!token) {
    res.redirect(`${frontendUrl}/login?error=not_authenticated`);
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.redirect(`${frontendUrl}/login?error=not_authenticated`);
    return;
  }

  const oauth2Client = buildOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    state: `${ADD_ACCOUNT_PREFIX}${payload.userId}`,
  });

  res.redirect(url);
});

// ─── Unified Google OAuth callback ───────────────────────────────────────────
// Handles both login and add-account flows via the same registered callback URL.
// If state starts with "add_account:", we skip Passport and handle it manually.

router.get('/google/callback', async (req, res, next) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const stateParam = req.query.state as string | undefined;

  // ── Add-account flow ──
  if (stateParam && stateParam.startsWith(ADD_ACCOUNT_PREFIX)) {
    try {
      const userId = stateParam.slice(ADD_ACCOUNT_PREFIX.length);
      const code = req.query.code as string | undefined;

      if (!code || !userId) {
        res.redirect(`${frontendUrl}/home?panel=settings&error=invalid_callback`);
        return;
      }

      // Verify the logged-in user matches the userId in the state parameter
      // to prevent an attacker from linking their Google account to another user
      const sessionToken = req.cookies?.token;
      const sessionPayload = sessionToken ? verifyToken(sessionToken) : null;
      if (!sessionPayload || sessionPayload.userId !== userId) {
        res.redirect(`${frontendUrl}/home?panel=settings&error=session_mismatch`);
        return;
      }

      // Verify the userId is real
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.redirect(`${frontendUrl}/home?panel=settings&error=user_not_found`);
        return;
      }

      // Exchange code for tokens
      const oauth2Client = buildOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get the email of the Google account just authorized
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data: profile } = await oauth2.userinfo.get();
      const accountEmail = profile.email?.toLowerCase();
      const accountName = profile.name || undefined;

      if (!accountEmail) {
        res.redirect(`${frontendUrl}/home?panel=settings&error=no_email`);
        return;
      }

      // Duplicate check: same as user's own login email
      if (accountEmail === user.email.toLowerCase()) {
        res.redirect(`${frontendUrl}/home?panel=settings&error=duplicate_account`);
        return;
      }

      // Duplicate check: email is another user's main (login) account
      const otherUser = await prisma.user.findUnique({ where: { email: accountEmail } });
      if (otherUser && otherUser.id !== userId) {
        res.redirect(`${frontendUrl}/home?panel=settings&error=already_linked`);
        return;
      }

      // Duplicate check: email is already linked to another user's CalendarAccount
      const otherAccount = await prisma.calendarAccount.findFirst({
        where: { email: accountEmail, userId: { not: userId } },
      });
      if (otherAccount) {
        res.redirect(`${frontendUrl}/home?panel=settings&error=already_linked`);
        return;
      }

      // Duplicate check: already linked to your own account
      const existing = await prisma.calendarAccount.findUnique({
        where: { userId_email: { userId, email: accountEmail } },
      });
      if (existing) {
        // Re-activate and update tokens if it was deactivated
        await prisma.calendarAccount.update({
          where: { id: existing.id },
          data: {
            googleAccessToken: encryptToken(tokens.access_token!),
            googleRefreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : existing.googleRefreshToken,
            isActive: true,
            name: accountName,
          },
        });
        res.redirect(`${frontendUrl}/home?panel=settings&msg=account_refreshed`);
        return;
      }

      // Create the new CalendarAccount
      await prisma.calendarAccount.create({
        data: {
          userId,
          email: accountEmail,
          name: accountName,
          googleAccessToken: encryptToken(tokens.access_token!),
          googleRefreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined,
        },
      });

      res.redirect(`${frontendUrl}/home?panel=settings&msg=account_added`);
    } catch (error) {
      console.error('Add account callback error:', error);
      res.redirect(`${frontendUrl}/home?panel=settings&error=add_account_failed`);
    }
    return;
  }

  // ── Normal login flow (via Passport) ──
  console.log('OAuth callback received, redirecting to:', frontendUrl);
  passport.authenticate('google', { session: false, failureRedirect: '/auth/failure' }, (err: Error | null, user: any) => {
    if (err?.message === 'INVITE_REQUIRED') {
      console.log('[auth] Sign-up blocked — no invite found');
      res.redirect(`${frontendUrl}/login?error=invite_required`);
      return;
    }
    if (err || !user) {
      console.error('Auth failed:', err);
      res.redirect(`${frontendUrl}/login?error=auth_failed`);
      return;
    }

    console.log('Auth successful, redirecting to:', frontendUrl);

    // Generate JWT token
    const token = generateToken({ userId: user.id, email: user.email });

    // Set token as httpOnly cookie with strict security
    res.cookie('token', token, cookieConfig);

    // Enrich user profile from Apollo in the background (non-blocking)
    enrichUserProfile(user.id).catch(() => {});

    // Send welcome email for new users (created within the last 60 seconds)
    const createdMs = user.createdAt ? Date.now() - new Date(user.createdAt).getTime() : null;
    console.log(`[auth] User ${user.email}: createdAt=${user.createdAt}, age=${createdMs}ms, isNew=${createdMs !== null && createdMs < 60_000}`);
    if (createdMs !== null && createdMs < 60_000) {
      sendWelcomeEmail({ id: user.id, email: user.email, name: user.name }, !!user.hasCalendarScope)
        .then(r => console.log(`[auth] Welcome email result:`, r))
        .catch(err => console.error(`[auth] Welcome email error:`, err));
    }

    // Redirect to frontend home page
    res.redirect(`${frontendUrl}/home`);
  })(req, res, next);
});

// Auth failure redirect
router.get('/failure', (req, res) => {
  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=auth_failed`);
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: (req as AuthenticatedRequest).user });
});

// Update current user profile
router.patch('/me', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { name, title, companyDomain, linkedinUrl, headline, city, country, timezone } = req.body;

    // Validate field types and lengths
    const stringFields = { name, title, linkedinUrl, headline, city, country, companyDomain, timezone };
    for (const [key, val] of Object.entries(stringFields)) {
      if (val !== undefined && typeof val !== 'string') {
        res.status(400).json({ error: `${key} must be a string` });
        return;
      }
      if (typeof val === 'string' && val.length > 500) {
        res.status(400).json({ error: `${key} is too long (max 500 characters)` });
        return;
      }
    }

    // Validate linkedinUrl is a safe URL if provided
    if (linkedinUrl !== undefined && linkedinUrl.trim()) {
      const url = linkedinUrl.trim().toLowerCase();
      if (!url.startsWith('https://') && !url.startsWith('http://')) {
        res.status(400).json({ error: 'linkedinUrl must be a valid URL starting with http:// or https://' });
        return;
      }
    }

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name.trim() || undefined;
    if (title !== undefined) updateData.title = title.trim() || null;
    if (linkedinUrl !== undefined) updateData.linkedinUrl = linkedinUrl.trim() || null;
    if (headline !== undefined) updateData.headline = headline.trim() || null;
    if (city !== undefined) updateData.city = city.trim() || null;
    if (country !== undefined) updateData.country = country.trim() || null;
    if (timezone !== undefined) updateData.timezone = timezone.trim() || null;

    // Company website → match to existing Company by domain
    if (companyDomain !== undefined) {
      const raw = (companyDomain as string).trim();
      if (raw) {
        // Normalise: strip protocol, www, trailing slashes → pure domain
        const domain = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
        updateData.companyDomain = domain;

        // Try to match an existing Company record
        const existingCompany = await prisma.company.findUnique({ where: { domain } });
        if (existingCompany) {
          updateData.company = existingCompany.name;
        } else {
          // Keep domain as company name fallback (user can see it's unmatched)
          updateData.company = domain;
        }
      } else {
        updateData.companyDomain = null;
        updateData.company = null;
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, email: true, name: true, role: true, avatar: true, title: true, company: true, companyDomain: true, linkedinUrl: true, headline: true, city: true, country: true, timezone: true, onboardingCompletedAt: true, onboardingChecklistDismissedAt: true },
    });

    invalidateUserCache(userId);
    res.json({ user });
  } catch (error: any) {
    console.error('Profile update error:', error.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update onboarding state
router.patch('/onboarding', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { tourCompleted, checklistDismissed } = req.body;

    const updateData: Record<string, any> = {};
    if (tourCompleted === true) updateData.onboardingCompletedAt = new Date();
    if (tourCompleted === false) updateData.onboardingCompletedAt = null;
    if (checklistDismissed === true) updateData.onboardingChecklistDismissedAt = new Date();
    if (checklistDismissed === false) updateData.onboardingChecklistDismissedAt = null;

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { onboardingCompletedAt: true, onboardingChecklistDismissedAt: true },
    });

    invalidateUserCache(userId);
    res.json({ success: true, ...user });
  } catch (error: any) {
    console.error('Onboarding update error:', error.message);
    res.status(500).json({ error: 'Failed to update onboarding state' });
  }
});

// Logout (POST for API calls)
router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: cookieConfig.path });
  res.json({ success: true });
});

// Logout (GET for simple links/redirects)
router.get('/logout', (req, res) => {
  res.clearCookie('token', { path: cookieConfig.path });
  res.redirect(process.env.FRONTEND_URL || 'http://localhost:5173');
});

// Check auth status (useful for frontend)
router.get('/status', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) {
    res.json({ authenticated: false });
    return;
  }
  
  // Verify the token is valid, not just that it exists
  const payload = verifyToken(token);
  if (!payload) {
    res.json({ authenticated: false });
    return;
  }

  // Verify the user still exists in the database
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true },
    });
    if (!user) {
      // User was deleted — clear the stale cookie
      res.clearCookie('token', { path: '/' });
      res.json({ authenticated: false });
      return;
    }
  } catch {
    res.json({ authenticated: false });
    return;
  }

  res.json({ authenticated: true });
});

export default router;
