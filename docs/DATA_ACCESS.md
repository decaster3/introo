# Data Access & Privacy Model

Internal documentation for how Introo controls data access across users, spaces, and connections.

---

## Data Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SHARED (Global)                              │
│                                                                     │
│  ┌──────────┐   Enriched company data from Apollo.                  │
│  │ Company  │   Shared across all users. No one "owns" a company.   │
│  └──────────┘   Contains: name, domain, industry, employees,        │
│                 funding, description, logo, location, LinkedIn.     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     USER-SCOPED (Private)                           │
│                                                                     │
│  ┌──────────┐   Belongs to exactly one user (userId).               │
│  │ Contact  │   Contains: name, email, title, headline, photo,      │
│  └──────────┘   LinkedIn, city, country, meeting history.           │
│                 Only visible to the owning user — unless shared      │
│                 through a Space or 1:1 Connection (with masking).   │
│                                                                     │
│  ┌──────────┐   User's tags for companies. Completely private.      │
│  │   Tag    │   Never shared with spaces, connections, or anyone.   │
│  └──────────┘                                                       │
│                                                                     │
│  ┌──────────┐   User's saved filter/sort configurations.            │
│  │  View    │   Completely private.                                  │
│  └──────────┘                                                       │
│                                                                     │
│  ┌──────────────┐   Calendar sync data. Private to user.            │
│  │ Meetings     │   Event titles, dates, durations.                  │
│  │ CalAccount   │   Google tokens, sync state.                       │
│  └──────────────┘   Never shared with anyone.                        │
│                                                                     │
│  ┌──────────────┐   Per-user, per-company. Private.                 │
│  │ Relationship │   Tracks meeting count + strength score.           │
│  └──────────────┘   Used to compute connection strength.             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Access Matrix

### What each user sees about their OWN data

| Data                      | Access   | Notes                                           |
|---------------------------|----------|-------------------------------------------------|
| Contact name              | Full     | —                                               |
| Contact email             | Full     | —                                               |
| Contact title / headline  | Full     | —                                               |
| Contact photo / LinkedIn  | Full     | —                                               |
| Meeting history           | Full     | Event titles, dates, duration                   |
| Connection strength       | Full     | Computed from meeting frequency                 |
| Company enriched data     | Full     | Industry, size, funding, description, etc.      |
| Tags                      | Full     | Only visible to the tag creator                 |
| Saved Views               | Full     | Only visible to the view creator                |

### What a SPACE MEMBER sees about other members' contacts

| Data                       | Access       | Notes                                                  |
|----------------------------|--------------|--------------------------------------------------------|
| Company name & domain      | **Yes**      | All enriched company data is shared                    |
| Company industry, size     | **Yes**      | From Apollo enrichment                                 |
| Company funding, revenue   | **Yes**      | From Apollo enrichment                                 |
| Contact name               | **Partial**  | Abbreviated only — e.g. "Nina B." (first name + last initial) |
| Contact job title          | **Yes**      | Visible to help identify the right person              |
| Contact photo / avatar     | **Hidden**   | Never shown for other members' contacts                |
| Contact email              | **Hidden**   | Completely hidden — never shown to other members       |
| Who knows the contact      | **Hidden**   | UI shows Space name, not the member's name             |
| Meeting history            | **No**       | Event titles, dates, frequency — never shared          |
| Last met date              | **Hidden**   | Never shown in table, card, or detail panel            |
| Connection strength        | **Hidden**   | Strong/medium/weak never shown for other members' contacts |
| Tags                       | **No**       | Completely private                                     |
| Saved Views                | **No**       | Completely private                                     |
| Member list                | **Yes**      | All members see who else is in the Space               |
| Intro requests             | **Partial**  | See own requests + requests where you're a connector   |

### What a 1:1 CONNECTION sees about the peer's contacts

| Data                       | Access       | Notes                                                  |
|----------------------------|--------------|--------------------------------------------------------|
| Company name & domain      | **Yes**      | All enriched company data is shared                    |
| Company industry, size     | **Yes**      | From Apollo enrichment                                 |
| Contact name               | **Partial**  | Abbreviated only — e.g. "Alex T." (first name + last initial) |
| Contact job title          | **Yes**      | Visible                                                |
| Contact photo / avatar     | **Hidden**   | Never shown for peer's contacts                        |
| Contact email              | **Hidden**   | Completely hidden — never shown to the peer            |
| Meeting history            | **No**       | Never shared                                           |
| Last met date              | **Hidden**   | Never shown in table, card, or detail panel            |
| Connection strength        | **Hidden**   | Strong/medium/weak never shown for peer's contacts     |
| Tags                       | **No**       | Private                                                |
| Saved Views                | **No**       | Private                                                |

---

## Sharing Flows

### Spaces

```
                    ┌─────────────────────┐
                    │       Space         │
                    │   "Sales Team"      │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
         │ Alice   │   │  Bob    │   │ Carol   │
         │ (owner) │   │(member) │   │(member) │
         └────┬────┘   └────┬────┘   └────┬────┘
              │              │              │
         ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
         │contacts │   │contacts │   │contacts │
         │ 50 ppl  │   │ 30 ppl  │   │ 45 ppl  │
         └─────────┘   └─────────┘   └─────────┘

   Each member contributes their approved contacts.
   All members see the COMBINED reach (companies + titles).
   Emails are masked. Meeting data is never shared.
   The UI shows "from Sales Team" — not "from Bob".
```

**Access control (backend):**
- `GET /api/spaces/:id/reach` — verifies user is owner or approved member
- Contacts query: `userId: { in: memberUserIds }, isApproved: true`
- For other members' contacts the API enforces at response level:
  - **Name**: abbreviated to first name + last initial (e.g. "Nina B.")
  - **Email**: replaced with `'••••••'`
  - **Photo**: returned as `null`
  - **Meetings count**: returned as `0`
  - **Last seen date**: returned as `null`
  - **Connection strength**: not included in response
- Own contacts are returned with full data
- Intro requests: filtered per-member (only see own + those you can help with)

### 1:1 Connections

```
         ┌─────────┐                    ┌─────────┐
         │  Alice  │◄──── accepted ────►│   Bob   │
         └────┬────┘                    └────┬────┘
              │                              │
         ┌────▼────┐                    ┌────▼────┐
         │contacts │    Alice sees      │contacts │
         │ 50 ppl  │◄── Bob's reach ───►│ 30 ppl  │
         └─────────┘    (masked)        └─────────┘

   Mutual: both see each other's companies + contacts.
   Emails completely hidden. Meeting data never shared.
```

**Access control (backend):**
- `GET /api/connections/:id/reach` — verifies connection is `accepted` and user is one of the two parties
- All peer contacts are masked at the API response level:
  - **Name**: abbreviated to first name + last initial (e.g. "Alex T.")
  - **Email**: replaced with `'••••••'`
  - **Photo**: returned as `null`
  - **Meetings count**: returned as `0`
  - **Last seen date**: returned as `null`
  - **Connection strength**: not included in response

---

## Contact Data Masking

Contact data for other users' contacts is **masked at the backend API level** before it leaves the server. This is not frontend-only filtering — the sensitive data is never sent to the client.

**What is masked for non-owned contacts:**

| Field              | Masked value         | Notes                                       |
|--------------------|----------------------|---------------------------------------------|
| Name               | First + last initial | e.g. "Nina Baghdasaryan" → "Nina B."        |
| Email              | `••••••`             | Completely replaced, no partial leak         |
| Photo / avatar URL | `null`               | Never sent for other users' contacts        |
| Meetings count     | `0`                  | Real count never leaves the server          |
| Last seen date     | `null`               | Real date never leaves the server           |
| Connection strength| Not included         | Never part of the reach API response        |

**Where masking applies:**
- `GET /api/spaces/:id/reach` — other members' contacts are masked; own contacts returned in full
- `GET /api/connections/:id/reach` — all peer contacts are masked (they are never your own)
- `GET /api/relationships/contacts` — only returns the authenticated user's own contacts (no masking needed)

---

## Intro Request Privacy

```
   Requester                    Space / Connection                  Connector
   ─────────                    ──────────────────                  ─────────

   Creates request ──────────►  Stored on server    ──────────►   Notified if they
   "Intro to Acme Inc"          with companyName,                  have contacts at
                                companyDomain                      the target company

   Sees: own request            Request is visible                Sees: request +
   + status (open/done)         to relevant members               their own contacts
                                only                               at that company
```

**Who sees intro requests in Spaces:**
- **Owner**: sees all requests
- **Requester**: sees their own requests
- **Other members**: only see requests where they were notified (they have contacts at the target company) or they already made an offer

**Who sees intro requests in 1:1 Connections:**
- Both parties see requests sent between them

**Connector actions (ask-details, make-intro, ask-permission):**
- "Ask for details" → sends email to requester, creates `details_requested` notification
- "Make intro" → sends double-intro email connecting requester + contact
- "Ask permission" → sends email to contact first, then introduces

---

## Notification Privacy

| Notification type         | Recipient        | Contains                                          |
|---------------------------|------------------|---------------------------------------------------|
| `connection_request`      | Target user      | Requester name, connection ID                     |
| `intro_request`           | Potential connectors | Requester name, company name, request text     |
| `intro_offered`           | Requester        | Introducer name, company name                     |
| `details_requested`       | Requester        | Connector name, company name                      |
| `intro_declined`          | Requester        | Company name, reason (optional)                   |
| `email_sent`              | Sender (self)    | Recipient email — used for rate limiting only     |

Notifications are always scoped to `userId`. A user can only read/delete their own notifications.

---

## Authentication & Authorization

**Invite-only sign-up:** New users must have a `PendingInvite` record before they can sign up. The Passport OAuth callback checks if the user already exists OR has a pending invite — if neither, sign-up is rejected with `INVITE_REQUIRED`.

All API routes use `authMiddleware` which:
1. Checks for a valid session cookie (Passport.js + Google OAuth)
2. Attaches `req.user` with `{ id, email, name }`
3. Rejects unauthenticated requests with 401

**Route-level authorization:**

| Route                          | Auth check                                              |
|--------------------------------|---------------------------------------------------------|
| `GET /api/relationships/*`     | `userId` from session — only own data                   |
| `GET /api/spaces/:id`          | Must be owner or approved member                        |
| `GET /api/spaces/:id/reach`    | Must be owner or approved member                        |
| `GET /api/connections/:id/reach`| Must be one of the two connected users + status accepted|
| `DELETE /api/relationships/contacts/:id` | Must own the contact (`contact.userId === userId`) |
| `POST /api/requests`           | Must be approved space member (if spaceId provided)     |
| `GET /api/requests/:id`        | Must be requester, space member, or connection peer     |
| `PATCH /api/requests/:id/*`    | Must be space member or connection peer (not requester) |
| `GET /api/tags`                | `userId` from session — only own tags                   |
| `GET /api/notifications`       | `userId` from session — only own notifications          |

---

## Data Lifecycle

### When a user deletes a contact
1. Contact record is deleted (meetings cascade via `onDelete: Cascade`)
2. If last contact at that company → Relationship record is cleaned up
3. Company record is **NOT** deleted (shared data, may be used by others)

### When a user leaves a Space
1. SpaceMember record is removed
2. Their contacts are immediately removed from the Space's reach
3. No contact/company data is deleted from their account

### When a 1:1 Connection is removed
1. DirectConnection status set to `rejected`
2. Both users immediately lose access to each other's reach
3. No contact/company data is deleted from either account

### When a user deletes their account
1. All user-scoped data cascades via `onDelete: Cascade`:
   - Contacts, Meetings, Relationships, Tags, CompanyTags
   - CalendarAccounts, SavedViews, Notifications
   - SpaceMemberships, IntroRequests, IntroOffers
2. Companies remain (shared data)
3. Spaces owned by the user: ownership would need to be transferred (currently cascades)

---

## Summary: What is NEVER shared

| Data                                | Shared?       |
|-------------------------------------|---------------|
| Full contact name                   | **Never** — abbreviated to first name + last initial (e.g. "Nina B.") |
| Contact photo / avatar              | **Never** — hidden for non-owned contacts |
| Full contact email addresses        | **Never** — completely hidden in spaces & connections |
| Meeting titles / calendar events    | **Never**     |
| Meeting dates / frequency           | **Never**     |
| Last met date                       | **Never** — hidden in table, card, and detail views |
| Connection strength (strong/medium/weak) | **Never** |
| Tags                                | **Never**     |
| Saved Views                         | **Never**     |
| Google OAuth tokens                 | **Never**     |
| Which specific member knows a contact (in Spaces) | **Never** (UI shows Space name) |

---
---

# Invisible Features & Backend Systems

Internal documentation for background processes, pipelines, and infrastructure that run behind the scenes.

---

## 1. Calendar Sync Pipeline

The calendar sync is the primary way contacts enter the system. It reads from Google Calendar and extracts business contacts from meeting attendees.

```
┌──────────────────────┐       ┌───────────────────────────┐       ┌──────────────────┐
│   Google Calendar    │       │   Calendar Sync Service    │       │    Database       │
│   (via googleapis)   │──────►│                           │──────►│                   │
│                      │       │  1. Fetch 5 years events  │       │  Company (upsert) │
│   Events:            │       │  2. Extract attendees     │       │  Contact (upsert) │
│   - attendees[]      │       │  3. Filter personal       │       │  Meeting (replace) │
│   - start/end time   │       │  4. Group by domain       │       │  Relationship     │
│   - summary          │       │  5. Batch upsert          │       │  CalendarAccount  │
└──────────────────────┘       └───────────────────────────┘       └──────────────────┘
```

### How it works

**Trigger:** Two ways:
1. **Manual** — user clicks "Sync Calendar" → `POST /api/calendar/sync`
2. **Background cron** — runs every **4 hours** for all users with connected calendars

**Steps:**
1. Decrypt stored OAuth tokens (AES-256-GCM)
2. Fetch all events from past **5 years** via Google Calendar API (paginated, 250/page)
3. Extract attendee emails from each event
4. Filter out:
   - User's own email
   - Personal domains (gmail, yahoo, hotmail, outlook, icloud, etc.)
   - System emails (calendar.google.com, noreply, notifications, etc.)
5. Aggregate per-contact: meeting count, last seen date, last event title
6. Batch upsert companies (50 per transaction, deduplicated by domain)
7. Batch upsert contacts (50 per transaction, deduplicated by `userId + email`)
8. Replace meetings — delete old, bulk insert most recent 10 per contact
9. Connect contacts to `CalendarAccount` for source tracking
10. Update sync timestamps on both `User` and `CalendarAccount`

### Token refresh

```
OAuth2 Client
     │
     ├── tokens event fires when access_token expires
     │
     └── Writes new encrypted tokens to:
              1. CalendarAccount (primary source of truth)
              2. User table (backward compatibility)
```

If token decryption fails entirely, both sources are cleared and the user must re-authenticate.

### What is filtered out

| Filter                     | Examples                                              |
|----------------------------|-------------------------------------------------------|
| Personal email domains     | gmail.com, yahoo.com, hotmail.com, outlook.com, etc. |
| System calendar addresses  | calendar.google.com, resource.calendar.google.com    |
| No-reply addresses         | noreply@, no-reply@, notifications@                  |
| User's own email           | Skipped automatically                                 |

### Data stored per contact

| Field            | Source                          |
|------------------|---------------------------------|
| email            | Attendee email (lowercased)     |
| name             | Attendee displayName            |
| domain           | Extracted from email            |
| meetingsCount    | Total events with this person   |
| lastSeenAt       | Most recent event date          |
| lastEventTitle   | Summary of most recent event    |
| meetings[]       | Last 10 events (title, date, duration in minutes) |

---

## 2. Apollo Enrichment Pipeline

Enriches contacts and companies with professional data from Apollo.io's API. Runs after calendar sync.

```
┌───────────────────┐      ┌────────────────────────────┐      ┌──────────────────┐
│  Contact records  │      │   Enrichment Service       │      │   Apollo API     │
│  (from DB)        │─────►│                            │─────►│                  │
│                   │      │  1. Group by domain        │      │ organizations/   │
│  Only contacts    │      │  2. Check internal cache   │      │   enrich         │
│  where enrichedAt │      │  3. Enrich company (1 cr)  │      │   (1 credit)     │
│  is null          │      │  4. Enrich person (1 cr)   │      │                  │
│                   │      │  5. Update DB              │      │ people/match     │
└───────────────────┘      └────────────────────────────┘      │   (1 credit)     │
                                                               └──────────────────┘
```

### Credit optimization strategy

The system minimizes Apollo API credits through multiple layers:

```
Contact needs enrichment?
     │
     ├── Generic email? (info@, team@, support@, etc.)
     │        └── YES → Skip (0 credits) — stamp enrichedAt
     │
     ├── Internal cache hit? (another user enriched same email)
     │        └── YES → Copy data (0 credits)
     │
     ├── Known no-match? (previously tried, Apollo had nothing)
     │        └── YES → Skip (0 credits) — stamp enrichedAt
     │
     └── None of the above
              └── Call Apollo people/match (1 credit)
```

**Company enrichment** works similarly — 1 credit per unique domain, skipped if already enriched.

### Enrichment modes

| Mode      | What it processes                          | When to use                      |
|-----------|-------------------------------------------|----------------------------------|
| Default   | Only contacts with `enrichedAt = null`    | Automatic, after calendar sync   |
| Force     | Retries failed contacts after 24h cooldown + re-enriches stale data (>7 days) | Manual "Re-enrich" button |

### Dev mode limits

In development (`NODE_ENV !== 'production'`), enrichment is capped at:
- **5 companies** (Apollo credits)
- **5 people** (Apollo credits)

### Real-time progress

Enrichment runs asynchronously in the background. The frontend polls `GET /api/enrichment/progress` to display a live progress bar showing enriched/skipped/errors counts. Users can cancel mid-run via `POST /api/enrichment/stop`.

### Data written

**Company (from `organizations/enrich`):**
name, industry, employeeCount, foundedYear, linkedinUrl, websiteUrl, logo, city, state, country, description, annualRevenue, totalFunding, lastFundingRound, lastFundingDate, technologies

**Contact (from `people/match`):**
name, title, headline, linkedinUrl, photoUrl, city, state, country, apolloId

### User profile enrichment

On first sign-up, the system also enriches the user's own profile (`enrichUserProfile`):
- Looks up the user's email in Apollo
- Fills in: title, headline, linkedinUrl, city, country, company, companyDomain
- Only fills fields that are currently empty (never overwrites)
- Costs 1 credit

---

## 3. Connection Strength Scoring

Connection strength is computed when contacts are approved (added to the user's network). It creates a per-user, per-company `Relationship` record.

### Formula

```
strengthScore = (recencyScore × 0.6 + frequencyScore × 0.4) × 100

Where:
  recencyScore  = max(0, 1 − daysSinceLastMeeting / 365)
  frequencyScore = min(1, meetingsCount / 20)
```

### Score interpretation

| Score Range | Label    | Meaning                                            |
|-------------|----------|----------------------------------------------------|
| 70–100      | Strong   | Recent meetings + high frequency                   |
| 40–69       | Medium   | Either recent or frequent, but not both             |
| 0–39        | Weak     | Old meetings or very few interactions              |

### When it's computed

- `POST /api/relationships/contacts/approve` — when user approves individual contacts
- `POST /api/relationships/contacts/approve-all` — when user approves all pending contacts

Aggregates all approved contacts at each company, sums their meetings, takes the most recent `lastSeenAt`, then computes the score.

---

## 4. Pending Invite System

Handles invitations to users who aren't on the platform yet.

```
User A invites bob@email.com
         │
         ├── bob@email.com exists in DB?
         │     ├── YES → Create DirectConnection (pending)
         │     │         Notify Bob in-app + email
         │     │
         │     └── NO → Create PendingInvite record
         │              Send invite email via Resend
         │
         └── Later, Bob signs up via Google OAuth
                    │
                    └── configurePassport() callback:
                         1. Find PendingInvite(s) for bob@email.com
                         2. For each invite:
                            ├── Has spaceId? → Create SpaceMember (pending)
                            │                  + notification
                            └── No spaceId? → Create DirectConnection (pending)
                                               + notification
                         3. Mark invites as 'converted'
```

### Invite types

| Type            | When created                    | What happens on signup              |
|-----------------|--------------------------------|--------------------------------------|
| 1:1 Connection  | `POST /api/connections` with unknown email | DirectConnection created (pending) |
| Space invite    | `POST /api/spaces/:id/invite` with unknown email | SpaceMember created (pending)   |

---

## 5. Background Cron Jobs

Two recurring background tasks run on fixed intervals:

### Calendar Sync (every 4 hours)

```
backgroundCalendarSync()
     │
     ├── Sync primary calendar for each user with googleAccessToken
     │     └── syncCalendarForUser(userId)
     │
     ├── Sync additional calendar accounts
     │     └── syncCalendarAccount(userId, accountId)
     │         (skips primary accounts already synced above)
     │
     └── Queue enrichment for all users with contacts
           └── runEnrichmentForUser(userId)
               (only enriches contacts with enrichedAt = null)
```

**Timing:** First run 30 seconds after server start, then every 4 hours.
**Concurrency guard:** `syncRunning` flag prevents overlapping runs.

### Weekly Digest Email (every 7 days)

```
backgroundWeeklyDigest()
     │
     └── For each user with calendar connected:
           │
           ├── Count new contacts (created in last 7 days)
           ├── Count new meetings (in last 7 days)
           ├── Count intro requests created
           ├── Count intro offers made
           ├── Top 5 companies by new contact count
           │
           ├── Skip if ALL counts are 0 (no email for quiet weeks)
           │
           └── Send digest email (respects user email preferences)
```

---

## 6. Email System (Resend)

All transactional emails are sent via the Resend API. Falls back to console logging in development when `RESEND_API_KEY` is not set.

### Email types

| Template              | Trigger                                 | Recipients           | Contains               |
|-----------------------|-----------------------------------------|----------------------|------------------------|
| Invite email          | Invite non-user to 1:1 connection       | Invited email        | Sender name, CTA       |
| Space invite email    | Invite non-user to a Space              | Invited email        | Space name, sender     |
| Welcome email         | First sign-up                           | New user             | Onboarding steps       |
| Intro offer email     | Someone offers an intro                 | Requester            | Company, introducer    |
| Double intro email    | Connector makes a warm intro            | Contact + Requester  | 3-way thread, CC'd     |
| Direct contact email  | User sends email through platform       | Recipient            | Custom subject/body    |
| Notification email    | Any in-app notification                 | Notification target  | Title, body, CTA       |
| Weekly digest         | Background cron (7 days)                | All active users     | Stats, top companies   |

### User email preferences

Users can toggle three email categories independently:

| Preference     | Controls                                    | Default |
|----------------|---------------------------------------------|---------|
| `intros`       | Intro offer/request emails                  | ON      |
| `notifications`| All notification emails                     | ON      |
| `digests`      | Weekly digest emails                        | ON      |

Stored as JSON on `User.emailPreferences`. Checked before sending notification and digest emails.

### Rate limiting

Direct contact emails (`POST /api/email/contact`) are rate-limited to **20 per user per hour**, tracked via `email_sent` notification records.

---

## 7. Security & Authentication

### Authentication flow

```
Browser                   Backend                    Google
  │                         │                          │
  ├── GET /auth/google ────►│                          │
  │                         ├── Redirect ─────────────►│
  │                         │                          │
  │◄─────────── Google OAuth consent screen ──────────►│
  │                         │                          │
  │                         │◄── Callback with code ───┤
  │                         │                          │
  │                         ├── Exchange code for tokens
  │                         ├── Encrypt tokens (AES-256-GCM)
  │                         ├── Upsert User + CalendarAccount
  │                         ├── Convert pending invites
  │                         ├── Generate JWT (7-day expiry)
  │                         │
  │◄── Set httpOnly cookie ─┤
  │    (token=JWT)          │
  │                         │
  │── Subsequent requests ──►── authMiddleware:
  │   (cookie: token=JWT)   │     1. Extract JWT from cookie/header
  │                         │     2. Verify signature + expiry
  │                         │     3. Check user cache (5-min TTL)
  │                         │     4. Fallback: DB lookup
  │                         │     5. Attach req.user
  │                         │
```

### Token encryption at rest

Google OAuth tokens (access + refresh) are encrypted before storage using AES-256-GCM:

```
Plaintext token
     │
     ├── Generate random 16-byte IV
     ├── Encrypt with AES-256-GCM using ENCRYPTION_KEY
     ├── Extract auth tag
     │
     └── Store as: iv_hex:auth_tag_hex:ciphertext_hex
```

Decryption reverses the process. If decryption fails (e.g., key rotation), tokens are cleared and the user must re-authenticate.

### User cache

To avoid a database hit on every authenticated request, an in-memory LRU cache stores user records:
- **TTL:** 5 minutes
- **Max size:** 10,000 entries
- **Eviction:** Periodic sweep every 10 minutes + oldest-entry eviction when full
- **Invalidation:** `invalidateUserCache(userId)` called after profile updates

### Security headers

Applied to every response via `securityHeaders` middleware:

| Header                    | Value                                     | Purpose                    |
|---------------------------|-------------------------------------------|----------------------------|
| X-Frame-Options           | DENY                                      | Prevent clickjacking       |
| X-Content-Type-Options    | nosniff                                   | Prevent MIME sniffing      |
| X-XSS-Protection          | 1; mode=block                             | Browser XSS filter         |
| Referrer-Policy           | strict-origin-when-cross-origin           | Limit referrer leakage     |
| Permissions-Policy        | camera=(), microphone=(), geolocation=(), payment=() | Restrict browser APIs |
| Strict-Transport-Security | max-age=31536000 (production only)        | Force HTTPS                |
| Content-Security-Policy   | Restrictive (enforced in prod, report-only in dev)   | XSS protection   |

### Cookie configuration

| Property   | Value             | Purpose                              |
|------------|-------------------|--------------------------------------|
| httpOnly   | true              | JavaScript can't read the cookie     |
| secure     | true (prod only)  | Only sent over HTTPS                 |
| sameSite   | lax               | CSRF protection for same-site deploy |
| maxAge     | 7 days            | Matches JWT expiry                   |
| path       | /                 | Available on all routes              |

### Rate limiting

| Scope            | Window     | Max requests (prod) | Max requests (dev) |
|------------------|------------|---------------------|--------------------|
| Global           | 15 minutes | 1,000               | 10,000 (disabled)  |
| Auth endpoints   | 15 minutes | 50                  | 1,000 (disabled)   |
| Email sending    | 1 hour     | 20 per user         | 20 per user        |

---

## 8. Company Name Normalization

When a company is created from a domain without Apollo data, the domain is normalized into a human-readable name:

```
normalizeCompanyName("stripe.com")          → "Stripe"
normalizeCompanyName("my.company.co.uk")    → "My Company"
normalizeCompanyName("acme-inc.org")        → "Acme-inc"
normalizeCompanyName("deep.learning.ai")    → "Deep Learning"
```

**Algorithm:**
1. Remove the last TLD segment (`.com`, `.io`, `.ai`, etc.)
2. Remove secondary TLDs (`.co`, `.org`, `.net`, `.ac`, `.gov`)
3. Split remaining parts by `.`
4. Capitalize first letter of each part
5. Join with spaces

Used in: `backend/src/routes/enrichment.ts`, `backend/src/services/calendar.ts`, `frontend/src/pages/AIHomePage.tsx`

---

## 9. Intro Request & Offer System

The intro flow involves three roles: **Requester**, **Connector**, and **Target Contact**.

```
                                  ┌─────────────────────┐
                                  │   Intro Request      │
                                  │   (requester creates)│
                                  └─────────┬───────────┘
                                            │
                     ┌──────────────────────┼──────────────────────┐
                     │                      │                      │
              Space request           1:1 Connection request
              (notifies members      (notifies peer who
               with contacts at       has contacts at
               target company)        target company)
                     │                      │
                     ▼                      ▼
              ┌─────────────┐       ┌─────────────┐
              │  Connector  │       │  Connector   │
              │  sees request│       │  sees request│
              └──────┬──────┘       └──────┬──────┘
                     │                      │
        ┌────────────┼────────────┐         │
        │            │            │         │
   Ask details  Ask permission  Make intro  │
   (email to    (email to       (3-way      │
    requester)   contact first)  email)     │
        │            │            │         │
        └────────────┴────────────┘         │
                     │                      │
              ┌──────▼──────┐               │
              │  IntroOffer │               │
              │  created    │◄──────────────┘
              └──────┬──────┘
                     │
              Requester accepts/rejects
              (accepting auto-rejects other pending offers)
```

### Connector actions

| Action          | What happens                                        | Emails sent           |
|-----------------|-----------------------------------------------------|-----------------------|
| Ask for details | Email to requester, `details_requested` notification| 1 (to requester)      |
| Ask permission  | Email to target contact                             | 1 (to contact)        |
| Make intro      | 3-way double-intro email (CC'd)                     | 1 (to contact + requester) |

---

## 10. Signals System

Signals are user-defined watchers that trigger on data changes (e.g., contact changes title, company headcount changes).

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  Signal       │       │  SignalMatch      │       │  Entity          │
│              │       │                  │       │  (Contact or     │
│  name        │──────►│  signalId        │       │   Company)       │
│  entityType  │       │  entityId ───────────────►│                  │
│  triggerType │       │  entityType      │       │                  │
│  config{}    │       │  summary         │       └──────────────────┘
│  isActive    │       │  isRead          │
│  userId      │       │  matchedAt       │
└──────────────┘       └──────────────────┘

All signals scoped to userId — users only see their own.
Signal matches link to entities (contacts/companies) via entityId.
```

### Access control

| Operation                  | Who can do it                        |
|---------------------------|--------------------------------------|
| Create signal             | Any authenticated user               |
| View signals              | Only the signal owner                |
| View/read signal matches  | Only the signal owner (verified via signal.userId) |
| Update signal             | Only the signal owner                |
| Delete signal             | Only the signal owner (cascades matches) |

---

## 11. Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` for clean shutdown:

```
Signal received (SIGTERM/SIGINT)
     │
     ├── Stop accepting new connections
     ├── Wait for in-flight requests to complete
     ├── Disconnect from database (prisma.$disconnect)
     ├── Exit with code 0
     │
     └── Force kill after 10 seconds if stuck
```

Additional safety:
- `unhandledRejection` — logged but doesn't crash
- `uncaughtException` — logged and exits with code 1

---

## 12. Environment Variables

| Variable             | Required | Purpose                                | Default (dev)          |
|----------------------|----------|----------------------------------------|------------------------|
| `DATABASE_URL`       | Yes      | PostgreSQL connection string           | —                      |
| `JWT_SECRET`         | Prod     | JWT signing key                        | dev-only fallback      |
| `ENCRYPTION_KEY`     | Prod     | AES-256 key for OAuth token encryption | dev-only fallback      |
| `GOOGLE_CLIENT_ID`   | Yes*     | Google OAuth client ID                 | —                      |
| `GOOGLE_CLIENT_SECRET`| Yes*    | Google OAuth client secret             | —                      |
| `GOOGLE_CALLBACK_URL`| Yes*    | OAuth callback URL                     | localhost:3001/auth/... |
| `FRONTEND_URL`       | Yes*     | Frontend origin (CORS + email links)   | localhost:5173         |
| `APOLLO_API_KEY`     | Yes*     | Apollo.io API key for enrichment       | —                      |
| `OPENAI_API_KEY`     | No       | OpenAI API for AI features             | —                      |
| `RESEND_API_KEY`     | No       | Resend API key for emails              | — (logs to console)    |
| `RESEND_FROM_EMAIL`  | No       | Sender email address                   | onboarding@resend.dev  |
| `NODE_ENV`           | No       | Environment mode                       | development            |
| `PORT`               | No       | Server port                            | 3001                   |

\* Recommended in production; the app will start without them but features will be broken.
