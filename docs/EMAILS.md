# Email System Documentation

All transactional emails are sent via the **Resend** API from `backend/src/services/email.ts`. In development (no `RESEND_API_KEY`), emails are logged to the console. In non-production environments, all emails are redirected to `DEV_EMAIL_REDIRECT` (or `rinat.khatipov@gmail.com` by default).

**From address:** `Introo <RESEND_FROM_EMAIL>`

---

## User Preferences

Users can opt out of specific email categories via Settings. Preferences are stored in `user.emailPreferences` (JSON field).

| Preference key | Controls                          | Default |
|----------------|-----------------------------------|---------|
| `intros`       | Intro-related emails              | `true`  |
| `notifications`| Notification emails               | `true`  |
| `digests`      | Weekly digest                     | `true`  |
| `briefings`    | Daily morning briefing            | `true`  |

---

## Email Templates

### 1. Welcome Email

| Field       | Value |
|-------------|-------|
| **Function**    | `sendWelcomeEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| First-time Google OAuth sign-up (user account age < 60 seconds) |
| **Trigger location** | `routes/auth.ts` — Google OAuth callback |
| **Recipient**   | The new user |
| **Subject**     | `Welcome to Introo, {firstName}!` |
| **Content**     | Two variants based on whether the user granted calendar access (see below) |
| **Preference**  | None (always sent) |
| **Rate limit**  | Once per user (only sent on first sign-up) |

#### Variants

| Variant | Condition | Content | CTA |
|---------|-----------|---------|-----|
| **Calendar connected** | User granted calendar scope during OAuth | Greeting, 3-step explanation (calendar sync happening now, contact enrichment, network map) | "Open Introo" |
| **No calendar** | User declined calendar scope during OAuth | Greeting, 3-step explanation (connect your calendar, enrichment, network map) | "Connect Calendar" |

---

### 2. Calendar Connection Reminder (3-ping sequence)

| Field       | Value |
|-------------|-------|
| **Function**    | `sendCalendarReminderEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| Background cron job (`backgroundCalendarReminders`) checking every 10 minutes |
| **Trigger location** | `index.ts` — scheduled task |
| **Recipient**   | Users who signed up but have not connected Google Calendar |
| **Preference**  | None (onboarding sequence, always sent) |
| **Tracked by**  | `user.calendarRemindersSent` (0, 1, 2, or 3) |
| **Stops when**  | User connects their calendar OR all 3 pings have been sent |

#### Ping schedule

| Ping | Timing | Subject | Content |
|------|--------|---------|---------|
| 1 | 30 minutes after sign-up | `{firstName}, your network map is waiting` | Gentle nudge explaining what happens when they connect (searchable network map, enrichment). Emphasizes it takes 60 seconds. |
| 2 | 1 day after sign-up | `{firstName}, you're missing out on your network` | Highlights three value props: searchable contacts, relationship strength, warm intro paths. |
| 3 | 3 days after sign-up | `Last reminder: connect your calendar, {firstName}` | Final reminder. Emphasizes no manual entry needed, offers to help via reply. |

---

### 3. Invite Email (1:1 Connection)

| Field       | Value |
|-------------|-------|
| **Function**    | `sendInviteEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| User sends a connection request to an email address that has no existing account |
| **Trigger location** | `routes/connections.ts` — `POST /connections` |
| **Recipient**   | The invited (non-user) email address |
| **Subject**     | `{senderName} invited you to Introo` |
| **Content**     | Sender name/email, explanation of Introo, CTA to join |
| **Preference**  | None (recipient is not a user yet) |
| **Condition**   | Target email does not match any existing user |

---

### 4. Space Invite Email

| Field       | Value |
|-------------|-------|
| **Function**    | `sendSpaceInviteEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| Space owner/admin invites a non-user email address to a Space |
| **Trigger location** | `routes/spaces.ts` — `POST /spaces/:id/members` (when target is not an existing user) |
| **Recipient**   | The invited (non-user) email address |
| **Subject**     | `{senderName} invited you to {emoji} {spaceName} on Introo` |
| **Content**     | Sender info, Space name, explanation of Spaces, CTA to join |
| **Preference**  | None (recipient is not a user yet) |
| **Condition**   | Target email does not match any existing user |

---

### 5. Invite Signup Reminders (4-ping sequence)

| Field       | Value |
|-------------|-------|
| **Functions**   | `sendInviteReminderEmail()` (1:1) / `sendSpaceInviteReminderEmail()` (space) |
| **File**        | `services/email.ts` |
| **Triggered by**| Background cron job (`backgroundInviteReminders`) checking every 1 hour |
| **Trigger location** | `index.ts` — scheduled task |
| **Recipient**   | Non-users who were invited (via 1:1 connection or space) but haven't signed up |
| **Preference**  | None (recipient is not a user yet) |
| **Tracked by**  | `pendingInvite.remindersSent` (0–4) |
| **Stops when**  | Recipient signs up OR all 4 pings have been sent |
| **Variants**    | Copy adapts based on invite type — 1:1 invites focus on the sender, space invites mention the space name |

#### 1:1 Connection Invite — ping schedule

| Ping | Timing | Subject | Content |
|------|--------|---------|---------|
| 1 | 1 day after invite | `{senderName} is waiting to connect with you` | Explains how Introo works: connect calendar, map network, request and make intros for each other. |
| 2 | 3 days after invite | `{senderName}'s invite: see who you both know` | Three use cases: finding clients, partners, like-minded people. Emphasizes seeing shared connections. |
| 3 | 7 days after invite | `The intros you're missing` | Scenario-driven: targeting a decision-maker, someone in your network knows them but you didn't know. Warm paths vs cold outreach. |
| 4 | 10 days after invite | `Last chance to connect with {senderName} on Introo` | Urgency: invitation will expire soon, one warm intro worth 100 cold emails. |

#### Space Invite — ping schedule

| Ping | Timing | Subject | Content |
|------|--------|---------|---------|
| 1 | 1 day after invite | `{senderName} invited you to {emoji} {spaceName}` | Explains spaces: private group, members make warm intros, 200+ companies reachable. |
| 2 | 3 days after invite | `{emoji} {spaceName} is waiting for you` | Three use cases: landing clients, finding partners, sharing deal flow across 1,000+ companies. |
| 3 | 7 days after invite | `{spaceName} members are making intros — without you` | Scenario: member requests HubSpot intro, another member makes it happen in a day. Your network isn't part of it yet. |
| 4 | 10 days after invite | `Last reminder: {senderName}'s invite to {emoji} {spaceName}` | Urgency: invitation will expire soon, your network could be the missing piece. |

---

### 6. Connection Acceptance Reminders (3-ping sequence)

| Field       | Value |
|-------------|-------|
| **Function**    | `sendConnectionReminderEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| Background cron job (`backgroundConnectionReminders`) checking every 1 hour |
| **Trigger location** | `index.ts` — scheduled task |
| **Recipient**   | Users who have a pending `DirectConnection` they haven't accepted |
| **Preference**  | Respects `notifications` preference (skipped if `false`) |
| **Tracked by**  | `directConnection.remindersSent` (0–3) |
| **Stops when**  | User accepts/rejects the connection OR all 3 pings have been sent |
| **Scope**       | **First pending invitation only** — if a user has multiple pending connections, only the oldest one triggers reminders |
| **Gate**        | Requires `calendarConnected = true` — if the user hasn't connected their calendar yet, the calendar reminder sequence runs instead and this sequence is deferred |
| **Sequence start** | `max(directConnection.createdAt, user.calendarConnectedAt)` — ensures users who connect their calendar late don't get bombarded |

#### Ping schedule

| Ping | Timing | Subject | Content |
|------|--------|---------|---------|
| 1 | 1 day after sequence start | `{senderName} is waiting on you` | Explains what connecting does: see each other's networks, get warm intros, help each other. Three value props with check marks. CTA: "Accept {senderFirst}'s Request". |
| 2 | 3 days after sequence start | `You and {senderName} — the intros you're both missing` | Scenario-driven: imagine the other person knows someone you're trying to reach. Connected members discover 3–5 intro paths. CTA: "Accept & Connect". |
| 3 | 7 days after sequence start | `Last reminder from {senderName}` | Final reminder. Acknowledges it's the last nudge. Reassures: request stays in dashboard if they change their mind. CTA: "Review Request". |

#### Sequencing with calendar reminders

This sequence is **gated behind calendar connection**. The flow for an invited user:

1. User signs up → **Calendar reminder sequence** fires (30min, 1d, 3d)
2. User connects calendar → Calendar sequence stops, `calendarConnectedAt` is set
3. **Connection acceptance sequence** begins, timed from `max(invite.createdAt, calendarConnectedAt)`
4. If the user never connects their calendar, connection reminders never fire

---

### 7. Intro Nudge Reminders (3-ping sequence)

| Field       | Value |
|-------------|-------|
| **Function**    | `sendIntroNudgeEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| Background cron job (`backgroundIntroNudgeReminders`) checking every 1 hour |
| **Trigger location** | `index.ts` — scheduled task |
| **Recipient**   | Users who have at least one accepted 1:1 connection or approved space membership, but have never created an intro request |
| **Preference**  | Respects `notifications` preference (skipped if `false`) |
| **Tracked by**  | `user.introRemindersSent` (0–3) |
| **Stops when**  | User creates their first intro request OR all 3 pings have been sent |
| **Scope**       | **First connection/space only** — the sequence only starts when the user's total accepted connections + approved spaces = 1. If they already have multiple, it's not their first and the sequence is skipped. |
| **Gate**        | Requires calendar connected (`googleAccessToken` set) |
| **Sequence start** | Earliest of `DirectConnection.updatedAt` (accepted) or `SpaceMember.joinedAt` (approved) |

#### Ping schedule

| Ping | Timing | Subject | Content |
|------|--------|---------|---------|
| 1 | 1 day after first connection/space | `{firstName}, try your first intro request` | Explains search → request → intro flow. Emphasizes simplicity: type what you need, tap request, done. |
| 2 | 3 days after first connection/space | `One search. One request. One intro.` | Three numbered steps: Search, Request, Connected. Reinforces that connections need to know what you're looking for. |
| 3 | 7 days after first connection/space | `{firstName}, your network is going unused` | Final nudge. Acknowledges they've done the hard part. One request, one intro — no cold outreach. |

#### Sequencing with other reminders

This sequence only fires after the user has:
1. Connected their calendar (calendar reminder sequence is done)
2. Accepted a connection or joined a space (connection acceptance sequence is done)
3. Not yet created any intro request

---

### 8. Intro Offer Email

| Field       | Value |
|-------------|-------|
| **Function**    | `sendIntroOfferEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| User clicks "Offer Intro" on another user's intro request, explicitly sending an email |
| **Trigger location** | `routes/email.ts` — `POST /email/intro-offer` |
| **Recipient**   | The intro requester |
| **Subject**     | `{senderName} can intro you to someone at {targetCompany}` |
| **Content**     | Sender name, target company, contact name (if provided), CTA to reply via email |
| **Reply-To**    | The sender's email (direct reply goes to sender) |
| **Preference**  | None (explicitly triggered action) |

---

### 9. Double Intro Email (3-way Introduction)

| Field       | Value |
|-------------|-------|
| **Function**    | `sendDoubleIntroEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| Connector marks an intro request as "done" by sending a 3-way intro email |
| **Trigger location** | `routes/email.ts` — `POST /email/double-intro` |
| **Recipients**  | The requester AND the contact (both in `to:`) |
| **CC**          | The sender/introducer |
| **Subject**     | `{senderName} intro: {requesterFirst} <> {contactFirst} ({targetCompany})` |
| **Content**     | Introduction context for both parties, invitation to reply-all |
| **Reply-To**    | The sender's email |
| **Preference**  | None (explicitly triggered action) |

---

### 10. Direct Contact Email

| Field       | Value |
|-------------|-------|
| **Function**    | `sendContactEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| User sends a direct message to a contact via the app (used for "Ask Details" and "Ask Permission" flows on intro requests, or general contact) |
| **Trigger location** | `routes/email.ts` — `POST /email/contact` |
| **Recipient**   | The target contact's email |
| **CC**          | The sender |
| **Subject**     | Custom (provided by the user) |
| **Content**     | Custom message body from the user |
| **Reply-To**    | The sender's email |
| **Preference**  | None (explicitly triggered action) |
| **Rate limit**  | Max 20 emails per user per hour |

#### Sub-actions (contact email with side effects)

- **`action: 'ask-details'`** — When a connector asks the requester for more details about their intro request. Updates `introRequest.detailsRequestedAt` and sends an additional notification email to the requester.
- **`action: 'ask-permission'`** — When a connector checks with their contact before making an intro. Updates `introRequest.checkedWithContact*` fields.

---

### 11. Notification Email

| Field       | Value |
|-------------|-------|
| **Function**    | `sendNotificationEmail()` |
| **File**        | `services/email.ts` |
| **Triggered by**| Any in-app notification that also warrants an email (see table below) |
| **Recipient**   | The user being notified |
| **Subject**     | Same as notification title |
| **Content**     | Notification title + body, CTA to open app |
| **Preference**  | Respects `notifications` preference (skipped if `false`) |

#### All notification types that trigger an email

| Notification Type | Trigger | Recipient | Title | Body |
|---|---|---|---|---|
| `connection_request` | User sends a 1:1 connection request | Target user | `{name} wants to connect` | Accept to share your networks with each other. |
| `connection_accepted` | User accepts a connection request | The original requester | `{name} accepted your connection` | You are now connected. |
| `intro_request` | New intro request created in a Space | Each space member who has contacts at the target company | `Intro request: {company}` | {requester} is looking for an intro to {company}. "{text}" |
| `intro_request` | New intro request via 1:1 connection | Connection peer | `Intro request: {company}` | {requester} is looking for an intro to {company}. "{text}" |
| `intro_review` | Intro request created in a Space with admin review enabled | Space owner | `Review request: {company}` | {requester} requested an intro to {company} in {space}. This request needs your approval. |
| `intro_approved` | Space owner approves a pending intro request | The requester | `Approved: {company}` | Your intro request to {company} in {space} was approved. Space members are now reviewing it. |
| `intro_approved` | Auto-approval when new member joins a Space (pending requests get approved) | The requester | `Approved: {company}` | Your intro request to {company} in {space} was approved. Space members are now reviewing it. |
| `intro_declined` | Connector declines an intro request | The requester | `Declined: {company}` | {name} can't make an intro to {company} right now. *(+ optional reason)* |
| `intro_declined` | Admin rejects a pending intro request | The requester | `Not approved: {company}` | Your intro request to {company} in {space} was not approved. *(+ optional reason)* |
| `intro_offered` | Connector offers an intro (via offer endpoint) | The requester | `Intro offered: {company}` | {name} offered to introduce you to someone at {company}. |
| `intro_offered` | Connector marks intro as done (double intro sent) | The requester | `Intro done: {company}` | {name} made an introduction for you to {company}. |
| `details_requested` | Connector sends "ask details" email for an intro request | The requester | `Details requested: {company}` | {name} wants more details about your intro request to {company}. Check your email and reply. |
| `space_join_request` | User requests to join a Space (approval required) | Space owner | `Join request: {space}` | {name} wants to join {emoji} {space}. |
| `space_member_joined` | User joins a Space (open join) | Space owner | `New member: {space}` | {name} joined {emoji} {space}. |
| `space_member_joined` | User accepts a Space invitation | Space owner | `New member: {space}` | {name} accepted the invitation to {emoji} {space}. |
| `space_approved` | Space owner approves a join request | The requesting member | `Welcome to {space}!` | Your request to join {emoji} {space} was approved. |
| `space_invited` | Space owner invites an existing user | The invited user | `Invitation to {space}` | {name} invited you to join {emoji} {space}. |
| `space_member_left` | Member leaves a Space voluntarily | Space owner | `Member left: {space}` | {name} left {emoji} {space}. |
| `space_removed` | Space owner removes a member | The removed member | `Removed from {space}` | You were removed from {emoji} {space}. |

---

### 12. Weekly Digest (Growth + Action)

| Field       | Value |
|-------------|-------|
| **Function**    | `sendWeeklyDigest()` |
| **File**        | `services/email.ts` |
| **Triggered by**| Background cron job (`backgroundWeeklyDigest`) checking every 15 minutes |
| **Trigger location** | `index.ts` — scheduled task |
| **Schedule**    | **Wednesday 10:00–10:14 AM** in the user's local timezone (uses `user.timezone`, falls back to UTC) |
| **Recipient**   | Each user with Google Calendar connected |
| **Subject**     | If action items: `{firstName}, {N} things need your attention + your weekly recap` — otherwise: `{firstName}, your week: {N} new contacts & {N} meetings` |
| **Preference**  | Respects `digests` preference (skipped if `false`) |
| **Conditions**  | Skipped if ALL stats are 0 AND no pending action items |

#### Sections (top to bottom)

| Section | Description |
|---------|-------------|
| **Stats grid with trends** | 4 stats: New Contacts, Meetings, You Requested, Asked of You. Each shows a trend badge comparing to the previous week (▲/▼ percentage, or `=` if flat, or `NEW` if previous was 0). |
| **Needs your attention** | Yellow callout listing pending actions: intro requests waiting for your help, intro offers you haven't responded to, unanswered connection requests. Each links to the app. Only shown if at least one action item exists. |
| **Intros completed** | Celebration block with party emoji showing how many intros were completed this week (status `done`). Only shown if > 0. |
| **Top companies** | Top 5 companies by new contact count, with company logo (or initial fallback). |
| **Insight line** | One contextual sentence in a purple callout. Picks the most interesting stat: top company growth, intros completed, or overall contact growth percentage. |
| **CTA button** | "Review & Respond" if there are action items, "See Your Network" otherwise. |

#### Data gathered by cron

| Data point | Query |
|------------|-------|
| `newContacts` / `prevContacts` | Contacts created this week vs previous week |
| `newMeetings` / `prevMeetings` | Meetings this week vs previous week |
| `introsSent` / `prevIntrosSent` | Intro requests created by user this week vs previous week |
| `introsReceived` / `prevIntrosReceived` | Intro requests from others visible to user (via spaces or 1:1 connections) this week vs previous week |
| `introsDone` | IntroOffers with status `done` updated this week where user is requester or introducer |
| `pendingRequestsForYou` | Open intro requests visible to user that they haven't offered on yet |
| `pendingOffersForYou` | Pending intro offers on user's own requests |
| `unansweredConnectionRequests` | Pending DirectConnections where user is the recipient |
| `topCompanies` | Top 5 companies by new contact count, with name and logo |
| `insight` | Auto-generated contextual sentence based on the most notable metric |

---

### 13. Daily Morning Briefing

| Field       | Value |
|-------------|-------|
| **Function**    | `sendDailyBriefing()` |
| **File**        | `services/email.ts` |
| **Triggered by**| Background cron job (`dailyMorningBriefing`) checking every 15 minutes |
| **Trigger location** | `index.ts` — scheduled task |
| **Recipient**   | Each user with Google Calendar connected |
| **Subject**     | `{firstName}, {N} meeting(s) today — your briefing` |
| **Content**     | Date header, meeting cards with enriched attendee data (name, title, LinkedIn, company info, relationship strength), new contacts saved count |
| **Preference**  | Respects `briefings` preference (skipped if `false`) |
| **Conditions**  | All of the following must be true: |
|                 | - Weekday only (Mon-Fri) |
|                 | - User's local time is 9:00-9:14 AM |
|                 | - Not already sent today (`lastBriefingDate` != today) |
|                 | - User has at least 1 calendar event today |

---

## Infrastructure

| Setting | Value |
|---------|-------|
| Provider | [Resend](https://resend.com) |
| Config | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` env vars |
| Dev redirect | All emails go to `DEV_EMAIL_REDIRECT` in non-production |
| Dev fallback | Console logging when `RESEND_API_KEY` is not set |
| Template | Shared `baseLayout()` with responsive HTML/CSS, Introo branding |
| Rate limiting | Contact emails: 20/user/hour (tracked via `notification` table with type `email_sent`) |
