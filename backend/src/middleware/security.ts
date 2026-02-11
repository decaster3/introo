import { Request, Response, NextFunction, RequestHandler } from 'express';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Security headers middleware
 * Adds essential security headers to all responses
 */
export const securityHeaders: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS filter in browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy - don't leak full URLs
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions policy - restrict browser features
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  
  // In production, add HSTS header
  if (isProduction) {
    // Strict Transport Security - force HTTPS for 1 year
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  
  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // May need adjustment based on frontend
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://accounts.google.com https://www.googleapis.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  
  // Use report-only in development to avoid blocking
  if (isProduction) {
    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  } else {
    res.setHeader('Content-Security-Policy-Report-Only', cspDirectives.join('; '));
  }
  
  next();
};

/**
 * Cookie security configuration for JWT cookies
 */
export const cookieConfig = {
  httpOnly: true,
  secure: isProduction, // Only require HTTPS in production
  sameSite: isProduction ? 'none' as const : 'lax' as const, // Cross-domain in prod, same-site in dev
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

/**
 * HTTPS redirect middleware (for use behind a load balancer/proxy)
 */
export const httpsRedirect: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  // Check X-Forwarded-Proto header (set by load balancers like AWS ALB, Heroku, etc.)
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  
  if (isProduction && !isSecure) {
    const httpsUrl = `https://${req.headers.host}${req.url}`;
    return res.redirect(301, httpsUrl);
  }
  
  next();
};

export default { securityHeaders, cookieConfig, httpsRedirect };
