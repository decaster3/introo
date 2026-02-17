import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import {
  sendIntroOfferEmail,
  sendDoubleIntroEmail,
  sendContactEmail,
  sendNotificationEmail,
} from '../services/email.js';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(authMiddleware);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

// ─── Send intro offer email ─────────────────────────────────────────────────

router.post('/intro-offer', async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const { recipientEmail, recipientName, targetCompany, contactName } = req.body;

    if (!recipientEmail || !recipientName || !targetCompany) {
      res.status(400).json({ error: 'recipientEmail, recipientName, and targetCompany are required' });
      return;
    }

    if (!isValidEmail(recipientEmail)) {
      res.status(400).json({ error: 'Invalid recipientEmail format' });
      return;
    }

    const result = await sendIntroOfferEmail({
      senderName: user.name,
      senderEmail: user.email,
      recipientEmail,
      recipientName,
      targetCompany,
      contactName,
    });

    if (!result.success) {
      res.status(500).json({ error: result.error || 'Failed to send email' });
      return;
    }

    res.json({ success: true, emailId: result.id });
  } catch (error: any) {
    console.error('Intro offer email error:', error.message);
    res.status(500).json({ error: 'Failed to send intro offer email' });
  }
});

// ─── Send double intro email ────────────────────────────────────────────────

router.post('/double-intro', async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const { requesterEmail, requesterName, contactEmail, contactName, targetCompany } = req.body;

    if (!requesterEmail || !requesterName || !contactEmail || !contactName || !targetCompany) {
      res.status(400).json({ error: 'requesterEmail, requesterName, contactEmail, contactName, and targetCompany are required' });
      return;
    }

    if (!isValidEmail(requesterEmail) || !isValidEmail(contactEmail)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const result = await sendDoubleIntroEmail({
      senderName: user.name,
      senderEmail: user.email,
      requesterEmail,
      requesterName,
      contactEmail,
      contactName,
      targetCompany,
    });

    if (!result.success) {
      res.status(500).json({ error: result.error || 'Failed to send email' });
      return;
    }

    res.json({ success: true, emailId: result.id });
  } catch (error: any) {
    console.error('Double intro email error:', error.message);
    res.status(500).json({ error: 'Failed to send double intro email' });
  }
});

// ─── Send direct contact email ──────────────────────────────────────────────

router.post('/contact', async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const { recipientEmail, recipientName, subject, body, requestId, action } = req.body;

    if (!recipientEmail || !subject || !body) {
      res.status(400).json({ error: 'recipientEmail, subject, and body are required' });
      return;
    }

    if (!isValidEmail(recipientEmail)) {
      res.status(400).json({ error: 'Invalid recipientEmail format' });
      return;
    }

    // Rate limit: max 20 emails per user per hour to prevent abuse
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await prisma.notification.count({
      where: {
        userId: user.id,
        type: 'email_sent',
        createdAt: { gte: oneHourAgo },
      },
    });
    if (recentCount >= 20) {
      res.status(429).json({ error: 'Email rate limit reached. Try again later.' });
      return;
    }

    const result = await sendContactEmail({
      senderName: user.name,
      senderEmail: user.email,
      recipientEmail,
      recipientName: recipientName || recipientEmail.split('@')[0],
      subject,
      body,
    });

    if (!result.success) {
      res.status(500).json({ error: result.error || 'Failed to send email' });
      return;
    }

    // If this is a "details requested" email for an intro request, notify the requester
    if (action === 'ask-details' && requestId) {
      try {
        const introReq = await prisma.introRequest.findUnique({
          where: { id: requestId },
          select: { requesterId: true, normalizedQuery: true },
        });
        if (introReq && introReq.requesterId !== user.id) {
          const nq = (introReq.normalizedQuery as Record<string, unknown>) || {};
          const companyName = (nq.companyName as string) || 'a company';
          const detailsNotif = {
            type: 'details_requested',
            title: `Details requested: ${companyName}`,
            body: `${user.name} wants more details about your intro request to ${companyName}. Check your email and reply.`,
          };
          await prisma.notification.create({
            data: {
              userId: introReq.requesterId,
              ...detailsNotif,
              data: {
                requestId,
                companyName,
                companyDomain: (nq.companyDomain as string) || null,
                connectorId: user.id,
                connectorName: user.name,
              },
            },
          });
          sendNotificationEmail(introReq.requesterId, detailsNotif).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to create details_requested notification:', err);
      }
    }

    // Track for rate limiting
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'email_sent',
        title: `Email to ${recipientEmail}`,
        body: subject,
        isRead: true,
        data: { recipientEmail },
      },
    }).catch(() => {});

    res.json({ success: true, emailId: result.id });
  } catch (error: any) {
    console.error('Contact email error:', error.message);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// ─── Update email preferences ───────────────────────────────────────────────

router.patch('/preferences', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { intros, notifications, digests } = req.body;

    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailPreferences: true },
    });

    const currentPrefs = (current?.emailPreferences as Record<string, boolean>) || {};
    const updatedPrefs = {
      ...currentPrefs,
      ...(intros !== undefined ? { intros } : {}),
      ...(notifications !== undefined ? { notifications } : {}),
      ...(digests !== undefined ? { digests } : {}),
    };

    await prisma.user.update({
      where: { id: userId },
      data: { emailPreferences: updatedPrefs },
    });

    res.json({ success: true, preferences: updatedPrefs });
  } catch (error: any) {
    console.error('Email preferences error:', error.message);
    res.status(500).json({ error: 'Failed to update email preferences' });
  }
});

// ─── Get email preferences ──────────────────────────────────────────────────

router.get('/preferences', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailPreferences: true },
    });

    const prefs = (user?.emailPreferences as Record<string, boolean>) || {
      intros: true,
      notifications: true,
      digests: true,
    };

    res.json(prefs);
  } catch (error: any) {
    console.error('Get email preferences error:', error.message);
    res.status(500).json({ error: 'Failed to get email preferences' });
  }
});

export default router;
