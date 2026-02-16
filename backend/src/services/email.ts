import { Resend } from 'resend';
import prisma from '../lib/prisma.js';

// ─── Resend client ───────────────────────────────────────────────────────────

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const APP_NAME = 'Introo';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

if (!resend) {
  console.warn('[email] RESEND_API_KEY not set — emails will be logged to console only.');
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export type EmailPreferences = {
  intros?: boolean;       // intro offer / double intro emails
  notifications?: boolean; // mirrors of in-app notifications
  digests?: boolean;       // weekly digest
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; padding: 0; background: #f6f8fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 40px 24px; }
    .card { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #111; margin-bottom: 24px; letter-spacing: -0.5px; }
    h1 { font-size: 22px; font-weight: 600; color: #111; margin: 0 0 12px; }
    p { font-size: 15px; line-height: 1.6; color: #333; margin: 0 0 16px; }
    .btn { display: inline-block; background: #111; color: #fff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; margin-top: 8px; }
    .muted { font-size: 13px; color: #888; margin-top: 24px; }
    .footer { text-align: center; margin-top: 32px; font-size: 12px; color: #aaa; }
    .footer a { color: #888; text-decoration: underline; }
    .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
    .stat { display: inline-block; text-align: center; padding: 0 16px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #111; }
    .stat-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo">${APP_NAME}</div>
      ${content}
    </div>
    <div class="footer">
      <a href="${FRONTEND_URL}">Open ${APP_NAME}</a>
    </div>
  </div>
</body>
</html>`;
}

async function send(params: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<EmailResult> {
  const { to, subject, html, replyTo } = params;

  if (!resend) {
    console.log(`[email][dev] To: ${Array.isArray(to) ? to.join(', ') : to} | Subject: ${subject}`);
    return { success: true, id: 'dev-noop' };
  }

  try {
    const result = await resend.emails.send({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });

    if (result.error) {
      console.error('[email] Resend error:', result.error);
      return { success: false, error: result.error.message };
    }

    return { success: true, id: result.data?.id };
  } catch (err) {
    console.error('[email] Send failed:', err);
    return { success: false, error: (err as Error).message };
  }
}

// ─── Check user email preferences before sending ─────────────────────────────

async function getUserEmailPrefs(userId: string): Promise<EmailPreferences> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailPreferences: true },
    });
    if (user?.emailPreferences && typeof user.emailPreferences === 'object') {
      return user.emailPreferences as EmailPreferences;
    }
  } catch {
    // Ignore — column may not exist yet
  }
  return { intros: true, notifications: true, digests: true };
}

async function getUserEmail(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email || null;
}

// ─── Email functions ─────────────────────────────────────────────────────────

/** Welcome email — sent after first signup */
export async function sendWelcomeEmail(user: { id: string; email: string; name: string }): Promise<EmailResult> {
  const html = baseLayout(`
    <h1>Welcome to ${APP_NAME}, ${user.name.split(' ')[0]}!</h1>
    <p>Your calendar is the key to your professional network. We turn your meeting history into a searchable, organized map of who you know.</p>
    <p>Here's what happens next:</p>
    <p><strong>1.</strong> We sync your calendar and extract contacts<br/>
    <strong>2.</strong> We enrich each contact with company data<br/>
    <strong>3.</strong> You get a powerful view of your network</p>
    <a href="${FRONTEND_URL}/home" class="btn">Open ${APP_NAME}</a>
    <p class="muted">You're receiving this because you signed up for ${APP_NAME}.</p>
  `);

  return send({ to: user.email, subject: `Welcome to ${APP_NAME}!` , html });
}

/** Intro offer email — "I can intro you to someone at X" */
export async function sendIntroOfferEmail(params: {
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
  recipientName: string;
  targetCompany: string;
  contactName?: string;
}): Promise<EmailResult> {
  const { senderName, senderEmail, recipientEmail, recipientName, targetCompany, contactName } = params;

  const connectionLine = contactName
    ? `I know <strong>${contactName}</strong> there and would be happy to make an introduction.`
    : `I have a contact there and would be happy to make an introduction.`;

  const html = baseLayout(`
    <h1>Intro Offer: ${targetCompany}</h1>
    <p>Hi ${recipientName},</p>
    <p>I saw your request for an intro to someone at <strong>${targetCompany}</strong>. ${connectionLine}</p>
    <p>Let me know if you'd like me to proceed!</p>
    <hr class="divider" />
    <p class="muted">Sent by ${senderName} via ${APP_NAME}. Reply directly to this email to respond.</p>
  `);

  return send({
    to: recipientEmail,
    subject: `${senderName} can intro you to someone at ${targetCompany}`,
    html,
    replyTo: senderEmail,
  });
}

/** Double intro email — introducing two people to each other */
export async function sendDoubleIntroEmail(params: {
  senderName: string;
  senderEmail: string;
  requesterEmail: string;
  requesterName: string;
  contactEmail: string;
  contactName: string;
  targetCompany: string;
}): Promise<EmailResult> {
  const { senderName, senderEmail, requesterEmail, requesterName, contactEmail, contactName, targetCompany } = params;

  const html = baseLayout(`
    <h1>Introduction: ${requesterName} ↔ ${contactName}</h1>
    <p>Hi ${contactName} and ${requesterName},</p>
    <p>I'd like to introduce you to each other.</p>
    <p><strong>${contactName}</strong> — ${requesterName} is interested in connecting with someone at ${targetCompany}.</p>
    <p><strong>${requesterName}</strong> — ${contactName} is at ${targetCompany} and I thought you two should meet.</p>
    <p>I'll let you both take it from here!</p>
    <hr class="divider" />
    <p class="muted">Sent by ${senderName} via ${APP_NAME}.</p>
  `);

  return send({
    to: [contactEmail, requesterEmail],
    subject: `Introduction: ${requesterName} ↔ ${contactName} (${targetCompany})`,
    html,
    replyTo: senderEmail,
  });
}

/** Direct contact email — simple email to a contact */
export async function sendContactEmail(params: {
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
}): Promise<EmailResult> {
  const { senderName, senderEmail, recipientEmail, recipientName, subject, body } = params;

  const html = baseLayout(`
    <p>Hi ${recipientName},</p>
    <p>${body.replace(/\n/g, '<br/>')}</p>
    <hr class="divider" />
    <p class="muted">Sent by ${senderName} via ${APP_NAME}. Reply directly to respond.</p>
  `);

  return send({
    to: recipientEmail,
    subject,
    html,
    replyTo: senderEmail,
  });
}

/** Notification email — mirrors an in-app notification as email */
export async function sendNotificationEmail(
  userId: string,
  notification: { type: string; title: string; body?: string | null }
): Promise<EmailResult> {
  const prefs = await getUserEmailPrefs(userId);
  if (prefs.notifications === false) {
    return { success: true, id: 'skipped-prefs' };
  }

  const email = await getUserEmail(userId);
  if (!email) return { success: false, error: 'User email not found' };

  const html = baseLayout(`
    <h1>${notification.title}</h1>
    ${notification.body ? `<p>${notification.body}</p>` : ''}
    <a href="${FRONTEND_URL}/home" class="btn">View in ${APP_NAME}</a>
    <p class="muted">You're receiving this because you have email notifications enabled.</p>
  `);

  return send({
    to: email,
    subject: notification.title,
    html,
  });
}

/** Weekly digest email — summary of network activity */
export async function sendWeeklyDigest(
  userId: string,
  stats: {
    newContacts: number;
    newMeetings: number;
    introRequests: number;
    introOffers: number;
    topCompanies: { name: string; contactCount: number }[];
  }
): Promise<EmailResult> {
  const prefs = await getUserEmailPrefs(userId);
  if (prefs.digests === false) {
    return { success: true, id: 'skipped-prefs' };
  }

  const email = await getUserEmail(userId);
  if (!email) return { success: false, error: 'User email not found' };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const firstName = user?.name?.split(' ')[0] || 'there';

  const topCompaniesHtml = stats.topCompanies.length > 0
    ? `<p><strong>Most active companies this week:</strong></p>
       <p>${stats.topCompanies.map(c => `${c.name} (${c.contactCount} contacts)`).join('<br/>')}</p>`
    : '';

  const html = baseLayout(`
    <h1>Your weekly network update</h1>
    <p>Hi ${firstName}, here's what happened in your network this week:</p>
    <div style="text-align: center; margin: 24px 0;">
      <div class="stat">
        <div class="stat-value">${stats.newContacts}</div>
        <div class="stat-label">New Contacts</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.newMeetings}</div>
        <div class="stat-label">Meetings</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.introRequests}</div>
        <div class="stat-label">Intro Requests</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.introOffers}</div>
        <div class="stat-label">Offers</div>
      </div>
    </div>
    ${topCompaniesHtml}
    <a href="${FRONTEND_URL}/home" class="btn">See Full Network</a>
    <p class="muted">You're receiving this weekly digest. You can disable it in Settings.</p>
  `);

  return send({
    to: email,
    subject: `Your ${APP_NAME} weekly update — ${stats.newContacts} new contacts`,
    html,
  });
}
