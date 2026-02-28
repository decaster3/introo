import { Resend } from 'resend';
import prisma from '../lib/prisma.js';

// ─── Resend client ───────────────────────────────────────────────────────────

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const APP_NAME = 'Introo';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ─── HTML escaping ───────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  briefings?: boolean;
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

const DEV_REDIRECT_EMAIL = process.env.NODE_ENV !== 'production' ? (process.env.DEV_EMAIL_REDIRECT || 'rinat.khatipov@gmail.com') : null;

async function send(params: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string | string[];
}): Promise<EmailResult> {
  let { to, subject, html, replyTo, cc } = params;

  if (DEV_REDIRECT_EMAIL) {
    const origTo = Array.isArray(to) ? to.join(', ') : to;
    const origCc = cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : '';
    subject = `[DEV → ${origTo}${origCc ? ` CC:${origCc}` : ''}] ${subject}`;
    to = DEV_REDIRECT_EMAIL;
    cc = undefined;
  }

  if (!resend) {
    console.log(`[email][dev] To: ${Array.isArray(to) ? to.join(', ') : to}${cc ? ` | CC: ${Array.isArray(cc) ? cc.join(', ') : cc}` : ''} | Subject: ${subject}`);
    return { success: true, id: 'dev-noop' };
  }

  try {
    const result = await resend.emails.send({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
      ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
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
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('Unknown field') || msg.includes('column') || msg.includes('does not exist')) {
      // Schema migration hasn't run yet — fall through to defaults
    } else {
      console.error('[email] Failed to read email preferences, defaulting to all-enabled:', msg);
    }
  }
  return { intros: true, notifications: true, digests: true, briefings: true };
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
  const safeSenderName = escapeHtml(senderName);
  const safeSenderEmail = escapeHtml(senderEmail);
  const senderFirst = escapeHtml(senderName.split(' ')[0]);

  const html = baseLayout(`
    <h1>${safeSenderName} wants to connect with you</h1>
    <p><span class="highlight">${safeSenderName}</span> (${safeSenderEmail}) invited you to join their professional network on ${APP_NAME}.</p>

    <div class="callout">
      <p><strong>What is ${APP_NAME}?</strong></p>
      <p style="margin-top: 8px;">${APP_NAME} turns your calendar into a searchable map of your professional network. Connect your Google Calendar and instantly see every person you've met with &mdash; enriched with company, role, and LinkedIn data.</p>
    </div>

    <p>When you join, you and ${senderFirst} will be able to see each other's networks and help each other with warm introductions.</p>

    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}" class="btn">Join ${APP_NAME}</a>
    </div>

    <hr class="divider" />
    <p class="muted">This invitation was sent by ${safeSenderName} via ${APP_NAME}. If you don't know this person, you can safely ignore this email.</p>
  `, { preheader: `${safeSenderName} invited you to connect on ${APP_NAME} — see who you both know.` });

  return send({
    to: recipientEmail,
    subject: `${safeSenderName} invited you to ${APP_NAME}`,
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
  const safeSenderName = escapeHtml(senderName);
  const safeSenderEmail = escapeHtml(senderEmail);
  const senderFirst = escapeHtml(senderName.split(' ')[0]);
  const safeSpaceName = escapeHtml(spaceName);
  const safeSpaceEmoji = escapeHtml(spaceEmoji);

  const html = baseLayout(`
    <h1>${safeSenderName} invited you to ${safeSpaceEmoji} ${safeSpaceName}</h1>
    <p><span class="highlight">${safeSenderName}</span> (${safeSenderEmail}) wants you to join their space <span class="highlight">${safeSpaceEmoji} ${safeSpaceName}</span> on ${APP_NAME}.</p>

    <div class="callout">
      <p><strong>What are Spaces?</strong></p>
      <p style="margin-top: 8px;">Spaces let you pool your professional networks with trusted people. Members can see each other's contacts, discover shared connections, and make warm introductions.</p>
    </div>

    <p>Join ${APP_NAME} to accept the invitation and start collaborating with ${senderFirst}.</p>

    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}" class="btn">Join ${APP_NAME}</a>
    </div>

    <hr class="divider" />
    <p class="muted">This invitation was sent by ${safeSenderName} via ${APP_NAME}. If you don't know this person, you can safely ignore this email.</p>
  `, { preheader: `${safeSenderName} invited you to the space "${safeSpaceName}" on ${APP_NAME}.` });

  return send({
    to: recipientEmail,
    subject: `${safeSenderName} invited you to ${safeSpaceEmoji} ${safeSpaceName} on ${APP_NAME}`,
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

/** Calendar reminder email — nudge users who haven't connected their calendar */
export async function sendCalendarReminderEmail(
  user: { id: string; email: string; name: string },
  ping: 1 | 2 | 3,
): Promise<EmailResult> {
  const firstName = user.name.split(' ')[0] || 'there';

  const content: Record<1 | 2 | 3, { subject: string; heading: string; body: string; preheader: string }> = {
    1: {
      subject: `${firstName}, your network map is waiting`,
      heading: `${firstName}, your network map is waiting`,
      body: `
        <p>You signed up for ${APP_NAME} — nice! But we noticed you haven't connected your Google Calendar yet.</p>
        <p>Once you do, we'll automatically build a searchable map of every person you've met with, enriched with company, role, and LinkedIn data. It takes about 60 seconds.</p>
      `,
      preheader: `Connect your calendar and we'll map your entire professional network.`,
    },
    2: {
      subject: `${firstName}, you're missing out on your network`,
      heading: `${firstName}, you're missing out on your network`,
      body: `
        <p>Quick reminder &mdash; ${APP_NAME} works best when it can see your calendar. Without it, we can't map your network.</p>
        <p>Here's what you'll unlock:</p>
        <div style="margin: 20px 0;">
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Every contact you've met with</span> &mdash; searchable by name, company, or role</div>
          </div>
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Relationship strength</span> &mdash; see who you're close to and who's fading</div>
          </div>
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Warm intro paths</span> &mdash; discover who can introduce you to people you want to meet</div>
          </div>
        </div>
        <p>It takes one click and about 60 seconds.</p>
      `,
      preheader: `You're missing out — connect your calendar to unlock your full network.`,
    },
    3: {
      subject: `Last reminder: connect your calendar, ${firstName}`,
      heading: `Connect your calendar, ${firstName}`,
      body: `
        <p>${APP_NAME} is built around your calendar &mdash; without it, there's not much we can do for you.</p>
        <p>Connect your Google Calendar and we'll instantly surface your entire professional network. No manual entry, no imports, no spreadsheets.</p>
        <p>If you have questions or need help, just reply to this email.</p>
      `,
      preheader: `Last reminder — connect your Google Calendar to get started with ${APP_NAME}.`,
    },
  };

  const c = content[ping];

  const html = baseLayout(`
    <h1>${c.heading}</h1>
    ${c.body}
    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}/home" class="btn">Connect Google Calendar</a>
    </div>
    <hr class="divider" />
    <p class="muted">Your calendar data is read-only and never shared with anyone. You can change your email preferences anytime in <a href="${FRONTEND_URL}/home?panel=settings" style="color: #71717a;">Settings</a>.</p>
  `, { preheader: c.preheader });

  return send({ to: user.email, subject: c.subject, html });
}

/** Connection acceptance reminder — nudge users who have a pending connection request they haven't accepted */
export async function sendConnectionReminderEmail(params: {
  recipientEmail: string;
  recipientName: string;
  senderName: string;
  ping: 1 | 2 | 3;
}): Promise<EmailResult> {
  const { recipientEmail, recipientName, senderName, ping } = params;
  const safeSenderName = escapeHtml(senderName);
  const senderFirst = escapeHtml(senderName.split(' ')[0]);

  const content: Record<1 | 2 | 3, { subject: string; heading: string; body: string; preheader: string }> = {
    1: {
      subject: `${safeSenderName} is waiting on you`,
      heading: `${safeSenderName} is waiting on you`,
      body: `
        <p><span class="highlight">${safeSenderName}</span> sent you a connection request on ${APP_NAME}.</p>
        <p>When you accept, you'll both be able to see each other's professional networks &mdash; every company, every contact, every intro path. It's how warm introductions happen.</p>

        <div style="margin: 20px 0;">
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">See who ${senderFirst} knows</span> &mdash; browse their contacts by company, role, or industry</div>
          </div>
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Get warm intros</span> &mdash; ask ${senderFirst} to introduce you to people in their network</div>
          </div>
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Help each other</span> &mdash; when ${senderFirst} needs an intro to someone you know, you'll get notified</div>
          </div>
        </div>
      `,
      preheader: `${safeSenderName} invited you to connect — accept to see each other's networks.`,
    },
    2: {
      subject: `You and ${safeSenderName} — the intros you're both missing`,
      heading: `The intros you're both missing`,
      body: `
        <p>${safeSenderName} sent you a connection request on ${APP_NAME} a few days ago. Here's what happens the moment you accept:</p>

        <div class="callout">
          <p>Imagine ${senderFirst} knows the VP of Sales at a company you've been trying to reach. Or you know someone at a company ${senderFirst} has been targeting for months. Right now, neither of you can see that. <strong>One click changes it.</strong></p>
        </div>

        <p>Connected members typically discover <span class="highlight">3&ndash;5 warm intro paths</span> they never knew existed. Paths that would have taken weeks of cold outreach &mdash; or never happened at all.</p>
        <p>It takes one click. No new permissions, no extra setup.</p>
      `,
      preheader: `Accept ${senderFirst}'s request and see where your networks overlap.`,
    },
    3: {
      subject: `Last reminder from ${safeSenderName}`,
      heading: `Last reminder: ${safeSenderName} wants to connect`,
      body: `
        <p>This is the last time we'll nudge you about this.</p>
        <p><span class="highlight">${safeSenderName}</span> sent you a connection request on ${APP_NAME} last week. If you accept, you'll both unlock each other's networks &mdash; making it easy to find warm intro paths to clients, partners, investors, or collaborators.</p>
        <p>If you're not interested, no action needed &mdash; the request will stay in your dashboard if you change your mind later.</p>
        <p>One warm intro is worth 100 cold emails.</p>
      `,
      preheader: `${senderFirst}'s connection request is still waiting — this is the last reminder.`,
    },
  };

  const c = content[ping];

  const html = baseLayout(`
    <h1>${c.heading}</h1>
    ${c.body}
    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}/home" class="btn">${ping === 3 ? 'Review Request' : `Accept ${senderFirst}'s Request`}</a>
    </div>
    <hr class="divider" />
    <p class="muted">You can review and manage all connection requests in your ${APP_NAME} dashboard. Change your email preferences anytime in <a href="${FRONTEND_URL}/home?panel=settings" style="color: #71717a;">Settings</a>.</p>
  `, { preheader: c.preheader });

  return send({ to: recipientEmail, subject: c.subject, html });
}

/** Intro nudge — nudge connected users who haven't requested their first intro */
export async function sendIntroNudgeEmail(
  user: { email: string; name: string },
  ping: 1 | 2 | 3,
): Promise<EmailResult> {
  const firstName = escapeHtml(user.name.split(' ')[0]) || 'there';

  const content: Record<1 | 2 | 3, { subject: string; heading: string; body: string; preheader: string }> = {
    1: {
      subject: `${firstName}, try your first intro request`,
      heading: `Try your first intro request`,
      body: `
        <p>You're connected on ${APP_NAME} &mdash; now put it to work.</p>
        <p>Type what you're looking for in the search bar &mdash; a role, a company, an industry. ${APP_NAME} shows you who in your network can get you there. Tap <span class="highlight">Request Intro</span>, and your connection gets notified instantly.</p>
        <p>That's it. No cold emails, no guesswork.</p>
      `,
      preheader: `Type what you're looking for, hit request, done.`,
    },
    2: {
      subject: `One search. One request. One intro.`,
      heading: `One search. One request. One intro.`,
      body: `
        <p>Here's how fast it works:</p>
        <div style="margin: 20px 0;">
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-text"><span class="highlight">Search</span> &mdash; type a company name, role, or industry</div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-text"><span class="highlight">Request</span> &mdash; tap "Request Intro" on any company card</div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-text"><span class="highlight">Connected</span> &mdash; your contact checks with their person and makes the intro</div>
          </div>
        </div>
        <p>The whole thing takes 10 seconds. Your connections are waiting to help &mdash; they just need to know what you're looking for.</p>
      `,
      preheader: `Your connections can't help if they don't know what you need.`,
    },
    3: {
      subject: `${firstName}, your network is going unused`,
      heading: `Your network is going unused`,
      body: `
        <p>You've done the hard part &mdash; connected your calendar, linked up with people you trust. But you haven't requested a single intro yet.</p>
        <p>Search for any company or role you care about. If someone in your network has a path there, you'll see it instantly. One request, one intro &mdash; no cold outreach needed.</p>
      `,
      preheader: `One warm intro is worth 100 cold emails.`,
    },
  };

  const c = content[ping];

  const html = baseLayout(`
    <h1>${c.heading}</h1>
    ${c.body}
    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}/home" class="btn">${ping === 3 ? 'Open ' + APP_NAME : ping === 2 ? 'Find an Intro' : 'Request Your First Intro'}</a>
    </div>
    <hr class="divider" />
    <p class="muted">You received this because you're connected on ${APP_NAME} but haven't requested an intro yet. Change your email preferences anytime in <a href="${FRONTEND_URL}/home?panel=settings" style="color: #71717a;">Settings</a>.</p>
  `, { preheader: c.preheader });

  return send({ to: user.email, subject: c.subject, html });
}

/** 1:1 invite reminder — nudge non-users who were invited but haven't signed up */
export async function sendInviteReminderEmail(params: {
  recipientEmail: string;
  senderName: string;
  ping: 1 | 2 | 3 | 4;
}): Promise<EmailResult> {
  const { recipientEmail, senderName, ping } = params;
  const safeSenderName = escapeHtml(senderName);
  const senderFirst = escapeHtml(senderName.split(' ')[0]);

  const content: Record<1 | 2 | 3 | 4, { subject: string; heading: string; body: string; preheader: string }> = {
    1: {
      subject: `${safeSenderName} is waiting to connect with you`,
      heading: `${safeSenderName} is waiting to connect with you`,
      body: `
        <p>${safeSenderName} invited you to ${APP_NAME} yesterday &mdash; a platform where professionals help each other get warm introductions.</p>
        <p>Here's how it works: you connect your Google Calendar, and ${APP_NAME} maps every person you've ever met with. Then, when ${senderFirst} needs an intro to someone at a company you know &mdash; or you need one from them &mdash; it's one click away.</p>
      `,
      preheader: `${safeSenderName} invited you to join ${APP_NAME} — help each other with warm intros.`,
    },
    2: {
      subject: `${safeSenderName}'s invite: see who you both know`,
      heading: `${safeSenderName} wants to swap intro paths with you`,
      body: `
        <p>A few days ago, ${safeSenderName} invited you to ${APP_NAME}. Here's what people use it for:</p>
        <div style="margin: 20px 0;">
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Finding clients</span> &mdash; "I need an intro to the Head of Marketing at Stripe." A connection who's met with them makes it happen.</div>
          </div>
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Finding partners</span> &mdash; "Anyone know someone at Notion?" Turns out your old colleague works there.</div>
          </div>
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Finding like-minded people</span> &mdash; discover shared connections at 500+ companies you didn't know you had in common.</div>
          </div>
        </div>
        <p>When you and ${senderFirst} connect on ${APP_NAME}, you both see where your networks overlap &mdash; and where you can open doors for each other.</p>
      `,
      preheader: `See who you and ${safeSenderName} both know — and help each other get warm intros.`,
    },
    3: {
      subject: `The intros you're missing`,
      heading: `The intros you're missing`,
      body: `
        <p>${safeSenderName} invited you to ${APP_NAME} last week. Here's a scenario:</p>
        <div class="callout">
          <p>Imagine you're trying to reach a decision-maker at a company you've been targeting for months. Cold emails aren't working. But someone in your network met with them last quarter &mdash; you just didn't know. On ${APP_NAME}, that intro request takes 10 seconds, and the person who knows them gets notified instantly.</p>
        </div>
        <p>The average professional has met with 300&ndash;800 people over the past few years. Most of those connections are invisible &mdash; sitting in your calendar, unused. ${APP_NAME} surfaces them so you can actually help each other: find clients, partners, investors, or collaborators through warm paths instead of cold outreach.</p>
        <p>It takes 60 seconds to connect your calendar. Read-only, no passwords shared.</p>
      `,
      preheader: `Your calendar holds intro paths you don't know about — ${safeSenderName} invited you to find them.`,
    },
    4: {
      subject: `Last chance to connect with ${safeSenderName} on ${APP_NAME}`,
      heading: `Last chance to connect with ${safeSenderName}`,
      body: `
        <p>${safeSenderName} invited you to ${APP_NAME} so you can help each other with warm introductions &mdash; to potential clients, partners, hires, or anyone else you're trying to reach.</p>
        <p>Users typically uncover 3&ndash;5 intro paths they never knew existed within their first week. One warm intro is worth 100 cold emails.</p>
        <div class="callout">
          <p>This invitation will expire soon. If you want access to ${senderFirst}'s network and the intro paths it unlocks, now is the time.</p>
        </div>
      `,
      preheader: `This invitation from ${safeSenderName} will expire soon — join now before you lose access.`,
    },
  };

  const c = content[ping];

  const html = baseLayout(`
    <h1>${c.heading}</h1>
    ${c.body}
    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}" class="btn">Join ${APP_NAME}</a>
    </div>
    <hr class="divider" />
    <p class="muted">This invitation was sent by ${safeSenderName} via ${APP_NAME}. If you don't know this person, you can safely ignore this email.</p>
  `, { preheader: c.preheader });

  return send({ to: recipientEmail, subject: c.subject, html });
}

/** Space invite reminder — nudge non-users who were invited to a space but haven't signed up */
export async function sendSpaceInviteReminderEmail(params: {
  recipientEmail: string;
  senderName: string;
  spaceName: string;
  spaceEmoji: string;
  ping: 1 | 2 | 3 | 4;
}): Promise<EmailResult> {
  const { recipientEmail, senderName, spaceName, spaceEmoji, ping } = params;
  const safeSenderName = escapeHtml(senderName);
  const safeSpaceName = escapeHtml(spaceName);
  const safeSpaceEmoji = escapeHtml(spaceEmoji);
  const spaceLabel = `${safeSpaceEmoji} ${safeSpaceName}`;

  const content: Record<1 | 2 | 3 | 4, { subject: string; heading: string; body: string; preheader: string }> = {
    1: {
      subject: `${safeSenderName} invited you to ${spaceLabel}`,
      heading: `${safeSenderName} invited you to ${spaceLabel}`,
      body: `
        <p>${safeSenderName} wants you to join ${spaceLabel} on ${APP_NAME} &mdash; a private group where members make warm introductions for each other.</p>
        <p>Here's how it works: everyone connects their calendar, and the group instantly sees who knows who across hundreds of companies. When you need an intro to a potential client, partner, or collaborator &mdash; you post a request and the member who knows them gets notified.</p>
        <p>Members of the average space can reach 200+ companies between them. Your network could unlock doors no one else in the group can.</p>
      `,
      preheader: `${safeSenderName} invited you to ${spaceLabel} — make warm intros together.`,
    },
    2: {
      subject: `${spaceLabel} is waiting for you`,
      heading: `${spaceLabel} is waiting for you`,
      body: `
        <p>A few days ago, ${safeSenderName} invited you to ${spaceLabel} on ${APP_NAME}. Here's what members use it for:</p>
        <div style="margin: 20px 0;">
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Landing clients</span> &mdash; "I need a warm intro to the VP of Sales at Datadog." Someone in the space met with them last month.</div>
          </div>
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Finding partners</span> &mdash; "Anyone connected to someone at Figma?" Three members have contacts there.</div>
          </div>
          <div class="step">
            <div class="step-num">&check;</div>
            <div class="step-text"><span class="highlight">Sharing deal flow</span> &mdash; members surface intro paths to 1,000+ companies across their combined networks.</div>
          </div>
        </div>
        <p>One request, one notification, one warm intro. No cold outreach, no awkward LinkedIn messages.</p>
      `,
      preheader: `Members of ${spaceLabel} are making intros — join and add your network.`,
    },
    3: {
      subject: `${safeSpaceName} members are making intros — without you`,
      heading: `${safeSpaceName} members are making intros &mdash; without you`,
      body: `
        <p>${safeSenderName} invited you to ${spaceLabel} on ${APP_NAME} last week. Here's a scenario:</p>
        <div class="callout">
          <p>A member posts: "Looking for an intro to someone at HubSpot." Another member who had a meeting with their team last quarter gets notified, checks with their contact, and makes the intro &mdash; all within a day. No cold emails, no guessing, no favors out of the blue.</p>
        </div>
        <p>This is happening in ${safeSpaceName} right now, but your network isn't part of it yet. The average professional has connections at 50&ndash;150 companies they've forgotten about. Joining takes 60 seconds &mdash; connect your calendar and your contacts are automatically mapped.</p>
      `,
      preheader: `${safeSpaceName} members are making intros without you — join now.`,
    },
    4: {
      subject: `Last reminder: ${safeSenderName}'s invite to ${spaceLabel}`,
      heading: `Last reminder: join ${spaceLabel}`,
      body: `
        <p>Members of ${spaceLabel} are actively requesting and making warm intros to clients, partners, and collaborators. Your network could be the missing piece &mdash; one intro you can make might be worth more than 100 cold emails for someone in the group.</p>
        <div class="callout">
          <p>This invitation will expire soon. If you want access to ${safeSpaceName}'s shared network and the intro paths it unlocks, now is the time to join.</p>
        </div>
      `,
      preheader: `This invitation to ${spaceLabel} will expire soon — join before you lose access.`,
    },
  };

  const c = content[ping];

  const html = baseLayout(`
    <h1>${c.heading}</h1>
    ${c.body}
    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}" class="btn">Join ${safeSpaceName}</a>
    </div>
    <hr class="divider" />
    <p class="muted">This invitation was sent by ${safeSenderName} via ${APP_NAME}. If you don't know this person, you can safely ignore this email.</p>
  `, { preheader: c.preheader });

  return send({ to: recipientEmail, subject: c.subject, html });
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
  const safeSenderName = escapeHtml(senderName);
  const safeSenderEmail = escapeHtml(senderEmail);
  const senderFirst = escapeHtml(senderName.split(' ')[0]);
  const recipientFirst = escapeHtml(recipientName.split(' ')[0]);
  const safeTargetCompany = escapeHtml(targetCompany);
  const safeContactName = contactName ? escapeHtml(contactName) : null;

  const connectionLine = safeContactName
    ? `They know <span class="highlight">${safeContactName}</span> at ${safeTargetCompany} and offered to make an introduction for you.`
    : `They have a connection at ${safeTargetCompany} and offered to make an introduction for you.`;

  const html = baseLayout(`
    <h1>${safeSenderName} can intro you to ${safeTargetCompany}</h1>
    <p><span class="highlight">${safeSenderName}</span> saw that you're looking for an intro to someone at <span class="highlight">${safeTargetCompany}</span>.</p>
    <p>${connectionLine}</p>

    <div class="callout">
      <p>Just reply to this email to connect directly with ${senderFirst} and take it from there.</p>
    </div>

    <div style="margin-top: 24px;">
      <a href="mailto:${safeSenderEmail}?subject=Re: Intro to ${encodeURIComponent(targetCompany)}" class="btn">Reply to ${senderFirst}</a>
    </div>

    <hr class="divider" />
    <p class="muted">This email was sent via ${APP_NAME} on behalf of ${safeSenderName}. You can also reply directly to this email &mdash; it goes straight to ${senderFirst}'s inbox.</p>
  `, { preheader: `${safeSenderName} can introduce you to someone at ${safeTargetCompany}.` });

  return send({
    to: recipientEmail,
    subject: `${safeSenderName} can intro you to someone at ${safeTargetCompany}`,
    html,
    replyTo: senderEmail,
  });
}

/** Double intro email — introducing two people to each other (3-way thread) */
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
  const safeSenderName = escapeHtml(senderName);
  const senderFirst = escapeHtml(senderName.split(' ')[0]);
  const safeRequesterName = escapeHtml(requesterName);
  const requesterFirst = escapeHtml(requesterName.split(' ')[0]);
  const safeContactName = escapeHtml(contactName);
  const contactFirst = escapeHtml(contactName.split(' ')[0]);
  const safeTargetCompany = escapeHtml(targetCompany);

  const html = baseLayout(`
    <h1>${safeSenderName} introduced you</h1>
    <p>Hi ${contactFirst} and ${requesterFirst},</p>
    <p>${safeSenderName} would love to connect you two. Here's a bit of context:</p>

    <div class="callout">
      <p><span class="highlight">${safeContactName}</span> &mdash; ${requesterFirst} has been looking to connect with someone at ${safeTargetCompany}, and I thought you'd be the perfect person.</p>
      <br/>
      <p><span class="highlight">${safeRequesterName}</span> &mdash; ${contactFirst} is at ${safeTargetCompany}. I think you'll have a lot to talk about.</p>
    </div>

    <p>Feel free to reply all to continue the conversation right here in this thread.</p>

    <hr class="divider" />
    <p class="muted">Sent from <a href="${FRONTEND_URL}" style="color: #6366f1; text-decoration: none; font-weight: 600;">${APP_NAME}</a> &mdash; warm intros through people you trust.</p>
  `, { preheader: `${senderFirst} just introduced ${requesterFirst} and ${contactFirst}.` });

  return send({
    to: [contactEmail, requesterEmail],
    cc: senderEmail,
    subject: `${safeSenderName} intro: ${requesterFirst} ↔ ${contactFirst} (${safeTargetCompany})`,
    html,
    replyTo: senderEmail,
  });
}

/** Direct contact email — a message from one user to a contact (2-way thread) */
export async function sendContactEmail(params: {
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
}): Promise<EmailResult> {
  const { senderName, senderEmail, recipientEmail, recipientName, subject, body } = params;

  const safeBody = escapeHtml(body).replace(/\n/g, '<br/>');
  const safeSenderName = escapeHtml(senderName);
  const html = baseLayout(`
    <p><strong>${safeSenderName}</strong> sent you a message:</p>
    <p>${safeBody}</p>

    <hr class="divider" />
    <p class="muted">Sent from <a href="${FRONTEND_URL}" style="color: #6366f1; text-decoration: none; font-weight: 600;">${APP_NAME}</a> &mdash; warm intros through people you trust.</p>
  `, { preheader: `${safeSenderName} sent you a message.` });

  return send({
    to: recipientEmail,
    cc: senderEmail,
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

  const safeTitle = escapeHtml(notification.title);
  const safeBody = notification.body ? escapeHtml(notification.body) : null;

  const html = baseLayout(`
    <h2>${safeTitle}</h2>
    ${safeBody ? `<p>${safeBody}</p>` : ''}

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

/** Weekly digest email — growth + action hybrid */
export interface DigestStats {
  newContacts: number;
  newMeetings: number;
  introsSent: number;
  introsReceived: number;
  introsDone: number;
  prevContacts: number;
  prevMeetings: number;
  prevIntrosSent: number;
  prevIntrosReceived: number;
  topCompanies: { name: string; logo?: string | null; contactCount: number }[];
  actionItems: {
    pendingRequestsForYou: number;
    pendingOffersForYou: number;
    unansweredConnectionRequests: number;
  };
  insight?: string;
}

function trendBadge(current: number, previous: number): string {
  if (previous === 0 && current === 0) return '';
  if (previous === 0) return `<span style="font-size: 11px; color: #22c55e; font-weight: 600; margin-left: 4px;">NEW</span>`;
  const diff = current - previous;
  if (diff === 0) return `<span style="font-size: 11px; color: #a1a1aa; margin-left: 4px;">=</span>`;
  const pct = Math.round((diff / previous) * 100);
  const arrow = diff > 0 ? '&#9650;' : '&#9660;';
  const color = diff > 0 ? '#22c55e' : '#ef4444';
  return `<span style="font-size: 11px; color: ${color}; font-weight: 600; margin-left: 4px;">${arrow} ${Math.abs(pct)}%</span>`;
}

export async function sendWeeklyDigest(
  userId: string,
  stats: DigestStats,
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

  // --- Action items section ---
  const { pendingRequestsForYou, pendingOffersForYou, unansweredConnectionRequests } = stats.actionItems;
  const totalActions = pendingRequestsForYou + pendingOffersForYou + unansweredConnectionRequests;

  const actionLines: string[] = [];
  if (pendingRequestsForYou > 0) {
    actionLines.push(`<tr><td style="padding: 8px 0; font-size: 14px; color: #3f3f46;">Intro requests waiting for your help</td><td style="padding: 8px 0; text-align: right;"><a href="${FRONTEND_URL}/home" style="color: #6366f1; font-weight: 600; font-size: 14px; text-decoration: none;">${pendingRequestsForYou} request${pendingRequestsForYou !== 1 ? 's' : ''} &rarr;</a></td></tr>`);
  }
  if (pendingOffersForYou > 0) {
    actionLines.push(`<tr><td style="padding: 8px 0; font-size: 14px; color: #3f3f46;">Intro offers you haven't responded to</td><td style="padding: 8px 0; text-align: right;"><a href="${FRONTEND_URL}/home" style="color: #6366f1; font-weight: 600; font-size: 14px; text-decoration: none;">${pendingOffersForYou} offer${pendingOffersForYou !== 1 ? 's' : ''} &rarr;</a></td></tr>`);
  }
  if (unansweredConnectionRequests > 0) {
    actionLines.push(`<tr><td style="padding: 8px 0; font-size: 14px; color: #3f3f46;">Connection requests waiting on you</td><td style="padding: 8px 0; text-align: right;"><a href="${FRONTEND_URL}/home" style="color: #6366f1; font-weight: 600; font-size: 14px; text-decoration: none;">${unansweredConnectionRequests} pending &rarr;</a></td></tr>`);
  }

  const actionHtml = totalActions > 0
    ? `<div style="background: #fefce8; border-radius: 12px; padding: 18px 20px; margin: 24px 0;">
        <div style="font-size: 13px; font-weight: 700; color: #a16207; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px;">Needs your attention</div>
        <table style="width: 100%; border-collapse: collapse;">${actionLines.join('')}</table>
       </div>`
    : '';

  // --- Top companies with logos ---
  const topCompaniesHtml = stats.topCompanies.length > 0
    ? `<hr class="divider" />
       <div style="font-size: 13px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 14px;">Top companies this week</div>
       ${stats.topCompanies.map(c => {
         const logoHtml = c.logo
           ? `<img src="${c.logo}" alt="" width="28" height="28" style="width: 28px; height: 28px; border-radius: 6px; margin-right: 12px; vertical-align: middle;" />`
           : `<span style="display: inline-block; width: 28px; height: 28px; border-radius: 6px; background: #f4f4f5; margin-right: 12px; vertical-align: middle; text-align: center; line-height: 28px; font-size: 13px; font-weight: 600; color: #71717a;">${escapeHtml(c.name.charAt(0))}</span>`;
         return `<div style="margin-bottom: 10px;">${logoHtml}<span style="font-size: 14px; font-weight: 600; color: #18181b; vertical-align: middle;">${escapeHtml(c.name)}</span> <span style="font-size: 13px; color: #a1a1aa; vertical-align: middle;">&mdash; ${c.contactCount} new contact${c.contactCount !== 1 ? 's' : ''}</span></div>`;
       }).join('')}`
    : '';

  // --- Insight line ---
  const insightHtml = stats.insight
    ? `<div style="background: #eef2ff; border-radius: 12px; padding: 16px 20px; margin: 20px 0;">
        <span style="font-size: 14px; color: #4338ca; line-height: 1.5;">${stats.insight}</span>
       </div>`
    : '';

  // --- Intros done this week ---
  const introsDoneHtml = stats.introsDone > 0
    ? `<hr class="divider" />
       <div style="text-align: center; padding: 8px 0;">
        <span style="font-size: 36px;">&#127881;</span>
        <div style="font-size: 15px; font-weight: 600; color: #18181b; margin-top: 6px;">${stats.introsDone} intro${stats.introsDone !== 1 ? 's' : ''} completed this week</div>
        <div style="font-size: 13px; color: #71717a; margin-top: 4px;">Warm connections that wouldn't have happened otherwise.</div>
       </div>`
    : '';

  const html = baseLayout(`
    <h1>Your week in review</h1>
    <p>Hey ${firstName}, here's how your network moved this week.</p>

    <div class="stat-row">
      <div class="stat">
        <div class="stat-value">${stats.newContacts}</div>
        <div class="stat-label">New Contacts ${trendBadge(stats.newContacts, stats.prevContacts)}</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.newMeetings}</div>
        <div class="stat-label">Meetings ${trendBadge(stats.newMeetings, stats.prevMeetings)}</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.introsSent}</div>
        <div class="stat-label">You requested ${trendBadge(stats.introsSent, stats.prevIntrosSent)}</div>
      </div>
      <div class="stat">
        <div class="stat-value">${stats.introsReceived}</div>
        <div class="stat-label">Asked of you ${trendBadge(stats.introsReceived, stats.prevIntrosReceived)}</div>
      </div>
    </div>

    ${actionHtml}
    ${introsDoneHtml}
    ${topCompaniesHtml}
    ${insightHtml}

    <div style="margin-top: 28px;">
      <a href="${FRONTEND_URL}/home" class="btn">${totalActions > 0 ? 'Review &amp; Respond' : 'See Your Network'}</a>
    </div>

    <p class="muted">Your weekly digest from ${APP_NAME}. <a href="${FRONTEND_URL}/home?panel=settings" style="color: #71717a;">Unsubscribe</a></p>
  `, { preheader: `${stats.newContacts} new contacts, ${stats.newMeetings} meetings${totalActions > 0 ? ` — ${totalActions} item${totalActions !== 1 ? 's' : ''} need attention` : ''}.` });

  return send({
    to: email,
    subject: totalActions > 0
      ? `${firstName}, ${totalActions} thing${totalActions !== 1 ? 's' : ''} need your attention + your weekly recap`
      : `${firstName}, your week: ${stats.newContacts} new contacts & ${stats.newMeetings} meetings`,
    html,
  });
}

/** Daily morning briefing — today's meetings with enriched attendee data */
export interface BriefingAttendee {
  name: string;
  title?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  companyIndustry?: string | null;
  companyEmployees?: number | null;
  companyFunding?: string | null;
  companyLinkedinUrl?: string | null;
  meetingsCount: number;
  strength: 'strong' | 'medium' | 'weak' | 'none';
  isInternal: boolean;
}

export interface BriefingMeeting {
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
  attendees: BriefingAttendee[];
}

function cleanCompanyName(name: string): string {
  return name.split(/\s[-–—|·]\s/)[0].trim();
}

function formatEmployees(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return count.toString();
}

const STRENGTH_COLORS: Record<string, string> = {
  strong: '#22c55e',
  medium: '#eab308',
  weak: '#a1a1aa',
  none: '#d4d4d8',
};

const TAG_STYLE = 'display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 4px; margin-right: 4px; margin-bottom: 4px;';
const TAG_MUTED = `${TAG_STYLE} background: #f4f4f5; color: #52525b;`;
const TAG_ACCENT = `${TAG_STYLE} background: #eef2ff; color: #4f46e5;`;

export async function sendDailyBriefing(
  userId: string,
  meetings: BriefingMeeting[],
  timezone: string,
): Promise<EmailResult> {
  const prefs = await getUserEmailPrefs(userId);
  if (prefs.briefings === false) {
    return { success: true, id: 'skipped-prefs' };
  }

  const email = await getUserEmail(userId);
  if (!email) return { success: false, error: 'User email not found' };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const firstName = user?.name?.split(' ')[0] || 'there';

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  });

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });

  const formatDuration = (min: number) => min >= 60
    ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`
    : `${min} min`;

  // Count new faces across all meetings (deduplicated by name)
  const externalCompanies = new Set<string>();
  const seenNewFaces = new Set<string>();
  meetings.forEach(m => m.attendees.forEach(a => {
    if (!a.isInternal && a.companyDomain) externalCompanies.add(a.companyDomain);
    if (!a.isInternal && a.meetingsCount === 0) seenNewFaces.add(a.name);
  }));
  const newFaces = seenNewFaces.size;

  const meetingsHtml = meetings.map(m => {
    const external = m.attendees.filter(a => !a.isInternal);
    const internal = m.attendees.filter(a => a.isInternal);
    const allInternal = external.length === 0;

    // Deduplicate company info — show company card once per unique external company
    const externalCompanyMap = new Map<string, { attendees: BriefingAttendee[]; industry?: string | null; employees?: number | null; funding?: string | null; linkedinUrl?: string | null }>();
    for (const a of external) {
      const key = a.companyDomain || a.name;
      const entry = externalCompanyMap.get(key);
      if (entry) {
        entry.attendees.push(a);
      } else {
        externalCompanyMap.set(key, {
          attendees: [a],
          industry: a.companyIndustry,
          employees: a.companyEmployees,
          funding: a.companyFunding,
          linkedinUrl: a.companyLinkedinUrl,
        });
      }
    }

    const renderAttendee = (a: BriefingAttendee) => {
      const dotColor = STRENGTH_COLORS[a.strength];
      const safeName = escapeHtml(a.name);

      const nameHtml = a.linkedinUrl
        ? `<a href="${a.linkedinUrl}" style="color: #18181b; text-decoration: none; font-size: 14px; font-weight: 600;">${safeName}</a> <a href="${a.linkedinUrl}" style="color: #0a66c2; text-decoration: none; font-size: 11px; font-weight: 500;">LinkedIn</a>`
        : `<span style="font-size: 14px; font-weight: 600; color: #18181b;">${safeName}</span>`;

      const detailParts: string[] = [];
      if (a.title) detailParts.push(escapeHtml(a.title));

      if (a.meetingsCount === 0) {
        detailParts.push(`<span style="color: #6366f1; font-weight: 600;">First meeting</span>`);
      } else {
        detailParts.push(`Met ${a.meetingsCount}x`);
      }

      return `<div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
        <div style="width: 8px; height: 8px; border-radius: 50%; background: ${dotColor}; flex-shrink: 0; margin-top: 6px;"></div>
        <div style="min-width: 0;">
          <div>${nameHtml}</div>
          <div style="font-size: 12px; color: #71717a; margin-top: 2px;">${detailParts.join(' &middot; ')}</div>
        </div>
      </div>`;
    };

    // Build external section — grouped by company with data tags
    let externalHtml = '';
    for (const [companyKey, group] of externalCompanyMap) {
      const companyName = group.attendees[0].companyName ? cleanCompanyName(group.attendees[0].companyName) : companyKey;
      const companyDomain = group.attendees[0].companyDomain;

      const companyLink = companyDomain
        ? `<a href="${FRONTEND_URL}/home?company=${encodeURIComponent(companyDomain)}" style="color: #18181b; text-decoration: none; font-weight: 700; font-size: 13px;">${escapeHtml(companyName)}</a>`
        : `<span style="font-weight: 700; font-size: 13px; color: #18181b;">${escapeHtml(companyName)}</span>`;

      const tags: string[] = [];
      if (group.industry) tags.push(`<span style="${TAG_MUTED}">${escapeHtml(group.industry)}</span>`);
      if (group.employees) tags.push(`<span style="${TAG_MUTED}">${formatEmployees(group.employees)} employees</span>`);
      if (group.funding) tags.push(`<span style="${TAG_ACCENT}">${escapeHtml(group.funding)}</span>`);
      if (group.linkedinUrl) tags.push(`<a href="${group.linkedinUrl}" style="${TAG_MUTED} text-decoration: none; color: #0a66c2;">LinkedIn</a>`);

      const tagsHtml = tags.length > 0
        ? `<div style="margin-top: 4px; margin-bottom: 8px;">${tags.join('')}</div>`
        : '';

      const viewLink = companyDomain
        ? `<div style="margin-top: 6px;"><a href="${FRONTEND_URL}/home?company=${encodeURIComponent(companyDomain)}" style="font-size: 12px; color: #6366f1; text-decoration: none; font-weight: 500;">Full profile, history &amp; LinkedIn &rarr;</a></div>`
        : '';

      externalHtml += `<div style="background: #ffffff; border: 1px solid #f0f0f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px;">
        ${companyLink}
        ${tagsHtml}
        <div style="margin-top: 8px;">${group.attendees.map(renderAttendee).join('')}</div>
        ${viewLink}
      </div>`;
    }

    // Internal attendees — collapsed or compact list
    let internalHtml = '';
    if (internal.length > 0) {
      if (allInternal) {
        const names = internal.map(a => escapeHtml(a.name)).join(', ');
        internalHtml = `<div style="font-size: 13px; color: #71717a; margin-top: 4px;">${names}</div>`;
      } else {
        internalHtml = `<div style="margin-top: 6px;">
          <div style="font-size: 12px; color: #a1a1aa;">+ ${internal.length} from your team</div>
        </div>`;
      }
    }

    return `<div style="background: #fafafa; border-radius: 12px; padding: 18px 20px; margin-bottom: 12px;">
      <div style="font-size: 11px; color: #a1a1aa; letter-spacing: 0.3px; font-weight: 600; margin-bottom: 6px;">${formatTime(m.startTime)} &middot; ${formatDuration(m.duration)}</div>
      <div style="font-size: 16px; font-weight: 700; color: #18181b; margin-bottom: 14px; line-height: 1.3;">${escapeHtml(m.title)}</div>
      ${externalHtml}${internalHtml}
    </div>`;
  }).join('');

  // Summary line
  const summaryParts: string[] = [`${meetings.length} meeting${meetings.length !== 1 ? 's' : ''}`];
  if (newFaces > 0) summaryParts.push(`${newFaces} new face${newFaces !== 1 ? 's' : ''}`);
  if (externalCompanies.size > 0) summaryParts.push(`${externalCompanies.size} ${externalCompanies.size !== 1 ? 'companies' : 'company'}`);

  // New contacts saved message
  const savedHtml = newFaces > 0
    ? `<div style="background: #eef2ff; border-radius: 10px; padding: 14px 18px; margin-top: 16px; font-size: 13px; color: #4338ca; line-height: 1.5;">
        ${newFaces} new contact${newFaces !== 1 ? 's' : ''} saved to your network. <a href="${FRONTEND_URL}/home" style="color: #4338ca; font-weight: 600;">View all contacts &rarr;</a>
      </div>`
    : '';

  const html = baseLayout(`
    <h1>Your day ahead</h1>
    <p style="color: #71717a; margin-bottom: 24px;">${dateLabel} &mdash; ${summaryParts.join(' &middot; ')}</p>

    ${meetingsHtml}
    ${savedHtml}

    <div style="margin-top: 24px;">
      <a href="${FRONTEND_URL}/home" class="btn">Open ${APP_NAME}</a>
    </div>

    <p class="muted">This is your daily briefing from ${APP_NAME}. You can turn it off in <a href="${FRONTEND_URL}/home?panel=settings" style="color: #71717a;">Settings</a>.</p>
  `, { preheader: `${summaryParts.join(' · ')} today — here's who you're meeting.` });

  return send({
    to: email,
    subject: `${firstName}, ${meetings.length} meeting${meetings.length !== 1 ? 's' : ''} today — your briefing`,
    html,
  });
}
