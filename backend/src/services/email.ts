import { Resend } from 'resend';
import prisma from '../lib/prisma.js';

// ─── Resend client ───────────────────────────────────────────────────────────

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const APP_NAME = 'Introo';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export type EmailPreferences = {
  intros?: boolean;
  notifications?: boolean;
  digests?: boolean;
};

// ─── Base layout ─────────────────────────────────────────────────────────────

function baseLayout(content: string, options?: { preheader?: string }): string {
  const preheader = options?.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${options.preheader}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body { margin: 0; padding: 0; background: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; -webkit-font-smoothing: antialiased; }
    .wrapper { max-width: 520px; margin: 0 auto; padding: 48px 20px 32px; }
    .card { background: #ffffff; border-radius: 16px; padding: 40px 36px 36px; }
    .logo { font-size: 18px; font-weight: 700; color: #18181b; letter-spacing: -0.3px; margin-bottom: 28px; }
    .logo span { color: #6366f1; }
    h1 { font-size: 21px; font-weight: 700; color: #18181b; margin: 0 0 8px; line-height: 1.3; }
    h2 { font-size: 17px; font-weight: 600; color: #18181b; margin: 0 0 8px; line-height: 1.4; }
    p { font-size: 15px; line-height: 1.65; color: #3f3f46; margin: 0 0 16px; }
    .highlight { color: #18181b; font-weight: 600; }
    .btn { display: inline-block; background: #18181b; color: #ffffff !important; text-decoration: none; padding: 13px 28px; border-radius: 10px; font-size: 14px; font-weight: 600; letter-spacing: -0.2px; margin-top: 4px; }
    .btn:hover { background: #27272a; }
    .btn-outline { display: inline-block; background: #ffffff; color: #18181b !important; text-decoration: none; padding: 11px 24px; border-radius: 10px; font-size: 14px; font-weight: 600; border: 1.5px solid #e4e4e7; margin-top: 4px; }
    .muted { font-size: 13px; color: #a1a1aa; margin-top: 24px; line-height: 1.5; }
    .footer { text-align: center; margin-top: 28px; padding: 0 12px; }
    .footer p { font-size: 12px; color: #a1a1aa; margin: 0 0 6px; }
    .footer a { color: #71717a; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    .divider { border: none; border-top: 1px solid #f4f4f5; margin: 24px 0; }
    .step { display: flex; align-items: flex-start; margin-bottom: 14px; }
    .step-num { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: #f4f4f5; color: #18181b; font-size: 13px; font-weight: 700; text-align: center; line-height: 28px; margin-right: 14px; margin-top: 1px; }
    .step-text { font-size: 15px; line-height: 1.5; color: #3f3f46; padding-top: 3px; }
    .callout { background: #fafafa; border-radius: 12px; padding: 20px 22px; margin: 20px 0; }
    .callout p { margin: 0; font-size: 14px; color: #52525b; }
    .stat-row { text-align: center; margin: 28px 0; }
    .stat { display: inline-block; text-align: center; padding: 0 18px; vertical-align: top; }
    .stat-value { font-size: 32px; font-weight: 800; color: #18181b; line-height: 1.2; }
    .stat-label { font-size: 11px; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.8px; margin-top: 4px; font-weight: 500; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; background: #e4e4e7; display: inline-block; vertical-align: middle; margin-right: 12px; }
    .person { margin-bottom: 16px; }
    .person-name { font-size: 15px; font-weight: 600; color: #18181b; vertical-align: middle; }
    .person-detail { font-size: 13px; color: #71717a; vertical-align: middle; }
    @media only screen and (max-width: 560px) {
      .wrapper { padding: 24px 12px 20px; }
      .card { padding: 28px 22px 24px; border-radius: 12px; }
      h1 { font-size: 19px; }
      .stat { padding: 0 12px; }
      .stat-value { font-size: 26px; }
    }
  </style>
</head>
<body>
  ${preheader}
  <div class="wrapper">
    <div class="card">
      <div class="logo"><span>&#9679;</span> ${APP_NAME}</div>
      ${content}
    </div>
    <div class="footer">
      <p><a href="${FRONTEND_URL}">Open ${APP_NAME}</a></p>
      <p style="margin-top: 8px; font-size: 11px; color: #d4d4d8;">${APP_NAME} &mdash; Your network, organized.</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Send helper ─────────────────────────────────────────────────────────────

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

// ─── User preferences ────────────────────────────────────────────────────────

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
    // Column may not exist yet
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

// ─── Email templates ─────────────────────────────────────────────────────────

/** Invite email — sent when someone invites a non-user to connect */
export async function sendInviteEmail(params: {
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
}): Promise<EmailResult> {
  const { senderName, senderEmail, recipientEmail } = params;
  const senderFirst = senderName.split(' ')[0];

  const html = baseLayout(`
    <h1>${senderFirst} wants to connect with you</h1>
    <p><span class="highlight">${senderName}</span> (${senderEmail}) invited you to join their professional network on ${APP_NAME}.</p>

    <div class="callout">
      <p><strong>What is ${APP_NAME}?</strong></p>
      <p style="margin-top: 8px;">${APP_NAME} turns your calendar into a searchable map of your professional network. Connect your Google Calendar and instantly see every person you've met with &mdash; enriched with company, role, and LinkedIn data.</p>
    </div>

    <p>When you join, you and ${senderFirst} will be able to see each other's networks and help each other with warm introductions.</p>

    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}" class="btn">Join ${APP_NAME}</a>
    </div>

    <hr class="divider" />
    <p class="muted">This invitation was sent by ${senderName} via ${APP_NAME}. If you don't know this person, you can safely ignore this email.</p>
  `, { preheader: `${senderName} invited you to connect on ${APP_NAME} — see who you both know.` });

  return send({
    to: recipientEmail,
    subject: `${senderFirst} invited you to ${APP_NAME}`,
    html,
  });
}

/** Space invite email — sent when inviting a non-user to a space */
export async function sendSpaceInviteEmail(params: {
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
  spaceName: string;
  spaceEmoji: string;
}): Promise<EmailResult> {
  const { senderName, senderEmail, recipientEmail, spaceName, spaceEmoji } = params;
  const senderFirst = senderName.split(' ')[0];

  const html = baseLayout(`
    <h1>${senderFirst} invited you to ${spaceEmoji} ${spaceName}</h1>
    <p><span class="highlight">${senderName}</span> (${senderEmail}) wants you to join their space <span class="highlight">${spaceEmoji} ${spaceName}</span> on ${APP_NAME}.</p>

    <div class="callout">
      <p><strong>What are Spaces?</strong></p>
      <p style="margin-top: 8px;">Spaces let you pool your professional networks with trusted people. Members can see each other's contacts, discover shared connections, and make warm introductions.</p>
    </div>

    <p>Join ${APP_NAME} to accept the invitation and start collaborating with ${senderFirst}.</p>

    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}" class="btn">Join ${APP_NAME}</a>
    </div>

    <hr class="divider" />
    <p class="muted">This invitation was sent by ${senderName} via ${APP_NAME}. If you don't know this person, you can safely ignore this email.</p>
  `, { preheader: `${senderName} invited you to the space "${spaceName}" on ${APP_NAME}.` });

  return send({
    to: recipientEmail,
    subject: `${senderFirst} invited you to ${spaceEmoji} ${spaceName} on ${APP_NAME}`,
    html,
  });
}

/** Welcome email — sent after first signup */
export async function sendWelcomeEmail(user: { id: string; email: string; name: string }): Promise<EmailResult> {
  const firstName = user.name.split(' ')[0] || 'there';

  const html = baseLayout(`
    <h1>Hey ${firstName}, welcome aboard!</h1>
    <p>Thanks for signing up for ${APP_NAME}. We're already working on mapping your professional network from your calendar.</p>

    <div style="margin: 24px 0 28px;">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text"><span class="highlight">Calendar sync</span> &mdash; we're pulling your meetings right now</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text"><span class="highlight">Contact enrichment</span> &mdash; we add company, role &amp; LinkedIn data</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text"><span class="highlight">Your network map</span> &mdash; search, filter, and discover who you know</div>
      </div>
    </div>

    <p>This usually takes just a minute or two. Once it's done, you'll have a searchable view of every person you've met with.</p>

    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}/home" class="btn">Open ${APP_NAME}</a>
    </div>

    <p class="muted">You received this because you just signed up for ${APP_NAME}. No action needed &mdash; we're setting everything up for you.</p>
  `, { preheader: `We're syncing your calendar and building your network map.` });

  return send({ to: user.email, subject: `Welcome to ${APP_NAME}, ${firstName}!`, html });
}

/** Intro offer email — someone can intro the recipient to a target company */
export async function sendIntroOfferEmail(params: {
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
  recipientName: string;
  targetCompany: string;
  contactName?: string;
}): Promise<EmailResult> {
  const { senderName, senderEmail, recipientEmail, recipientName, targetCompany, contactName } = params;
  const recipientFirst = recipientName.split(' ')[0];
  const senderFirst = senderName.split(' ')[0];

  const connectionLine = contactName
    ? `They know <span class="highlight">${contactName}</span> at ${targetCompany} and offered to make an introduction for you.`
    : `They have a connection at ${targetCompany} and offered to make an introduction for you.`;

  const html = baseLayout(`
    <h1>Good news, ${recipientFirst}!</h1>
    <p><span class="highlight">${senderName}</span> saw that you're looking for an intro to someone at <span class="highlight">${targetCompany}</span>.</p>
    <p>${connectionLine}</p>

    <div class="callout">
      <p>Just reply to this email to connect directly with ${senderFirst} and take it from there.</p>
    </div>

    <div style="margin-top: 24px;">
      <a href="mailto:${senderEmail}?subject=Re: Intro to ${targetCompany}" class="btn">Reply to ${senderFirst}</a>
    </div>

    <hr class="divider" />
    <p class="muted">This email was sent via ${APP_NAME} on behalf of ${senderName}. You can also reply directly to this email &mdash; it goes straight to ${senderFirst}'s inbox.</p>
  `, { preheader: `${senderName} can introduce you to someone at ${targetCompany}.` });

  return send({
    to: recipientEmail,
    subject: `${senderFirst} can intro you to someone at ${targetCompany}`,
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
  const senderFirst = senderName.split(' ')[0];
  const requesterFirst = requesterName.split(' ')[0];
  const contactFirst = contactName.split(' ')[0];

  const html = baseLayout(`
    <h1>Meet each other!</h1>
    <p>Hi ${contactFirst} and ${requesterFirst},</p>
    <p>I'd love to connect you two. Here's a bit of context:</p>

    <div class="callout">
      <p><span class="highlight">${contactName}</span> &mdash; ${requesterFirst} has been looking to connect with someone at ${targetCompany}, and I thought you'd be the perfect person.</p>
      <br/>
      <p><span class="highlight">${requesterName}</span> &mdash; ${contactFirst} is at ${targetCompany}. I think you'll have a lot to talk about.</p>
    </div>

    <p>I'll leave it to you both to take it from here. Feel free to reply-all or reach out to each other directly.</p>

    <hr class="divider" />
    <p class="muted">Intro made by ${senderName} via ${APP_NAME}. Both parties are CC'd on this email.</p>
  `, { preheader: `${senderFirst} just introduced ${requesterFirst} and ${contactFirst}.` });

  return send({
    to: [contactEmail, requesterEmail],
    subject: `${senderFirst} intro: ${requesterFirst} ↔ ${contactFirst} (${targetCompany})`,
    html,
    replyTo: senderEmail,
  });
}

/** Direct contact email — a message from one user to a contact */
export async function sendContactEmail(params: {
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
}): Promise<EmailResult> {
  const { senderName, senderEmail, recipientEmail, recipientName, subject, body } = params;
  const recipientFirst = recipientName.split(' ')[0];
  const senderFirst = senderName.split(' ')[0];

  const html = baseLayout(`
    <p>Hi ${recipientFirst},</p>
    <p>${body.replace(/\n/g, '<br/>')}</p>

    <div style="margin-top: 24px;">
      <a href="mailto:${senderEmail}?subject=Re: ${subject}" class="btn">Reply to ${senderFirst}</a>
    </div>

    <hr class="divider" />
    <p class="muted">Sent by ${senderName} via ${APP_NAME}. You can also reply directly to this email.</p>
  `, { preheader: `${senderName} sent you a message.` });

  return send({
    to: recipientEmail,
    subject,
    html,
    replyTo: senderEmail,
  });
}

/** Notification email — mirrors an in-app notification */
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
    <h2>${notification.title}</h2>
    ${notification.body ? `<p>${notification.body}</p>` : ''}

    <div style="margin-top: 20px;">
      <a href="${FRONTEND_URL}/home" class="btn">View in ${APP_NAME}</a>
    </div>

    <p class="muted">You're receiving this because you have email notifications turned on. You can change this anytime in <a href="${FRONTEND_URL}/home?panel=settings" style="color: #71717a;">Settings</a>.</p>
  `, { preheader: notification.body || notification.title });

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

  const hasActivity = stats.newContacts > 0 || stats.newMeetings > 0 || stats.introRequests > 0 || stats.introOffers > 0;

  const topCompaniesHtml = stats.topCompanies.length > 0
    ? `<hr class="divider" />
       <h2>Top companies this week</h2>
       <p>${stats.topCompanies.map(c => `<span class="highlight">${c.name}</span> &mdash; ${c.contactCount} contact${c.contactCount !== 1 ? 's' : ''}`).join('<br/>')}</p>`
    : '';

  const summaryLine = hasActivity
    ? `Here's what happened in your network this past week.`
    : `It was a quiet week. Here's a quick snapshot of your network.`;

  const html = baseLayout(`
    <h1>Your week in review</h1>
    <p>Hey ${firstName}, ${summaryLine}</p>

    <div class="stat-row">
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
        <div class="stat-label">Requests</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.introOffers}</div>
        <div class="stat-label">Offers</div>
      </div>
    </div>

    ${topCompaniesHtml}

    <div style="margin-top: 28px;">
      <a href="${FRONTEND_URL}/home" class="btn">See Your Network</a>
    </div>

    <p class="muted">This is your weekly digest from ${APP_NAME}. You can turn it off anytime in <a href="${FRONTEND_URL}/home?panel=settings" style="color: #71717a;">Settings</a>.</p>
  `, { preheader: `${stats.newContacts} new contacts, ${stats.newMeetings} meetings this week.` });

  return send({
    to: email,
    subject: `${firstName}, your week: ${stats.newContacts} new contacts & ${stats.newMeetings} meetings`,
    html,
  });
}
