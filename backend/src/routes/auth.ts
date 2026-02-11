import { Router } from 'express';
import passport from 'passport';
import { generateToken, verifyToken, authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { cookieConfig } from '../middleware/security.js';

const router = Router();

// Initiate Google OAuth
router.get('/google', (req, res, next) => {
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback';
  console.log('Initiating OAuth with callbackURL:', callbackURL);
  
  passport.authenticate('google', {
    accessType: 'offline',
    prompt: 'consent',
    callbackURL, // Explicitly pass callback URL
  })(req, res, next);
});

// Google OAuth callback
router.get(
  '/google/callback',
  (req, res, next) => {
    console.log('OAuth callback received, redirecting to:', process.env.FRONTEND_URL);
    next();
  },
  passport.authenticate('google', { session: false, failureRedirect: '/auth/failure' }),
  (req, res) => {
    const user = req.user as any;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    console.log('Auth successful, redirecting to:', frontendUrl);
    
    if (!user) {
      res.redirect(`${frontendUrl}/login?error=auth_failed`);
      return;
    }

    // Generate JWT token
    const token = generateToken({ userId: user.id, email: user.email });

    // Set token as httpOnly cookie with strict security
    res.cookie('token', token, cookieConfig);

    // Redirect to frontend home page
    res.redirect(`${frontendUrl}/`);
  }
);

// Auth failure redirect
router.get('/failure', (req, res) => {
  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=auth_failed`);
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: (req as AuthenticatedRequest).user });
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
router.get('/status', (req, res) => {
  const token = req.cookies?.token;
  if (!token) {
    res.json({ authenticated: false });
    return;
  }
  
  // Verify the token is valid, not just that it exists
  const payload = verifyToken(token);
  res.json({ authenticated: !!payload });
});

export default router;
