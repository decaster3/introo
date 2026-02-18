# Introo — Product & Architecture Overview

Internal documentation. Start here, then dive into specific topics.

**Related docs:**
- [Data Access & Privacy Model](./DATA_ACCESS.md) — who sees what, access control, email masking
- [Data Access & Privacy Model — Invisible Features](./DATA_ACCESS.md#invisible-features--backend-systems) — calendar sync, enrichment, cron jobs, security

---

## What is Introo?

Introo turns your Google Calendar into a searchable map of your professional network. It extracts every person you've ever met with, enriches them with company data, and lets you share that network with trusted people to make warm introductions.

**One-liner:** A relationship intelligence tool that replaces spreadsheets, CRMs, and cold outreach with real data from your calendar.

---

## How It Works — The Big Picture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Google       │     │  Calendar Sync   │     │  Apollo          │     │  Your Network    │
│  Calendar     │────►│  Service         │────►│  Enrichment      │────►│  Map             │
│              │     │                  │     │                  │     │                  │
│  5 years of  │     │  Extract emails  │     │  Add name, title │     │  Companies       │
│  meetings    │     │  Filter personal │     │  photo, LinkedIn │     │  People          │
│              │     │  Group by domain │     │  funding, size   │     │  Strength scores │
└──────────────┘     └──────────────────┘     └──────────────────┘     └──────────────────┘
                                                                               │
                                                                               ▼
                                                                  ┌──────────────────────┐
                                                                  │  Share & Collaborate  │
                                                                  │                      │
                                                                  │  1:1 Connections     │
                                                                  │  Spaces (groups)     │
                                                                  │  Warm Intros         │
                                                                  └──────────────────────┘
```

---

## User Journey

### Step 1: Get Invited & Sign Up (Google OAuth)

Introo is invite-only. A new user must have a `PendingInvite` record (created when an existing user invites them by email) before they can sign up. If no invite exists, the OAuth callback rejects with `INVITE_REQUIRED`.

```
Browser → Google OAuth → Backend checks:
                           1. User already exists? → Allow (returning user)
                           2. PendingInvite exists for this email? → Allow (new invited user)
                           3. Neither? → REJECT (redirect to /login?error=invite_required)
                         → Creates/updates User record
                         → Encrypts OAuth tokens (AES-256-GCM)
                         → Issues JWT cookie (7-day expiry)
                         → Converts pending invites into connections/space memberships
                         → Redirects to /home
```

**Details:** [Security & Authentication](./DATA_ACCESS.md#7-security--authentication)

### Step 2: Calendar Sync

Introo scans the user's Google Calendar (past 5 years) and extracts business contacts from meeting attendees.

```
Google Calendar API (paginated, 250/page)
     │
     ├── For each event, extract attendee emails
     ├── Filter out personal domains (gmail, yahoo, etc.)
     ├── Filter out system addresses (calendar.google.com, noreply, etc.)
     ├── Aggregate: meetings count, last seen date, last event title
     │
     ├── Batch upsert Companies (by domain, 50/transaction)
     ├── Batch upsert Contacts (by userId + email, 50/transaction)
     └── Store last 10 meetings per contact
```

**After sync:** The user sees a list of all their business contacts, grouped by company.

**Details:** [Calendar Sync Pipeline](./DATA_ACCESS.md#1-calendar-sync-pipeline)

### Step 3: Contact Approval

Synced contacts initially have `isApproved = false`. The user reviews them and approves which ones to include in their network. Approving triggers **connection strength scoring**:

```
strengthScore = (recency × 0.6  +  frequency × 0.4) × 100

recency   = max(0, 1 − daysSinceLastMeeting / 365)    → rewards recent meetings
frequency = min(1, meetingsCount / 20)                  → rewards frequent meetings
```

| Score    | Label    | Meaning                                |
|----------|----------|----------------------------------------|
| 70–100   | Strong   | Recent + frequent meetings             |
| 40–69    | Medium   | Either recent or frequent, not both    |
| 0–39     | Weak     | Old or rare meetings                   |

**Details:** [Connection Strength Scoring](./DATA_ACCESS.md#3-connection-strength-scoring)

### Step 4: Enrichment

In the background, Apollo.io enriches each contact and company with professional data.

```
For each contact:
     │
     ├── Generic email? (info@, team@, support@) → skip (0 credits)
     ├── Already enriched by another user? → copy from cache (0 credits)
     ├── Previously tried, no data? → skip (0 credits)
     └── New contact → Apollo people/match API call (1 credit)
           └── Writes: name, title, headline, LinkedIn, photo, city, country

For each company domain:
     └── Apollo organizations/enrich API call (1 credit)
           └── Writes: industry, size, funding, revenue, logo, description
```

**Details:** [Apollo Enrichment Pipeline](./DATA_ACCESS.md#2-apollo-enrichment-pipeline)

### Step 5: Explore, Filter, Organize

The main screen (`/home`) is a single-page app with two tabs:

| Tab        | Shows                                          | Sortable by                                      |
|------------|-------------------------------------------------|--------------------------------------------------|
| Companies  | All companies, grouped by your contacts there  | Name, contact count, strength, employees, location, industry, last contact date |
| People     | All individual contacts                         | Name, company, title, last contact date, meetings |

**Sidebar filters:**
- Source (mine / spaces / connections)
- Connection strength (strong / medium / weak)
- Tags (user-defined)
- Spaces & 1:1 connections
- Last contact date (years, months)
- Company details (industry, size, location, funding, etc.)

**Saved Views:** Users can save any combination of filters, sort rules, and search keywords as a named View for one-click access.

**Tags:** Colored labels attached to companies (e.g., "Target," "Customer," "Investor"). Private — never shared with anyone.

### Step 6: Connect & Share

Two ways to share your network with others:

#### 1:1 Connections

```
Alice invites Bob (by email)
     │
     ├── Bob is on Introo? → Create DirectConnection (pending)
     │                        Bob sees a notification + email
     │                        Bob accepts → both see each other's companies + contacts
     │
     └── Bob NOT on Introo? → Create PendingInvite
                               Send invite email
                               When Bob signs up → auto-create DirectConnection (pending)
```

**What's shared:** Company names, contact names, job titles
**What's hidden:** Contact emails (completely hidden, not even partially shown)
**What's NEVER shared:** Meeting data, strength scores, tags, views

**Details:** [Data Access — 1:1 Connections](./DATA_ACCESS.md#what-a-11-connection-sees-about-the-peers-contacts)

#### Spaces (Group Sharing)

```
Owner creates Space "Sales Team"
     │
     ├── Invites Alice, Bob, Carol (by email)
     ├── Members can be on Introo or invited externally
     │
     └── All approved members contribute their contacts
         → Combined reach view: every company any member knows
         → Emails hidden, meeting data hidden
         → UI shows "from Sales Team" not "from Bob"
```

**Space roles:**
- **Owner:** Sees all intro requests, manages members, can delete space
- **Member:** Sees combined reach, creates requests, only sees relevant requests

**Details:** [Data Access — Spaces](./DATA_ACCESS.md#what-a-space-member-sees-about-other-members-contacts)

### Step 7: Request & Make Intros

The intro system connects three roles: **Requester** (wants an intro), **Connector** (knows someone), and **Target Contact** (the person to be introduced to).

```
Requester: "I need an intro to someone at Stripe"
     │
     ├── In a Space → All members with contacts at Stripe get notified
     ├── In a 1:1 Connection → Peer gets notified if they have contacts at Stripe
     │
     └── Connector sees the request and can:
              │
              ├── "Ask for details"  → Emails requester for more context
              │                        Creates details_requested notification
              │
              ├── "Ask permission"   → Emails the target contact first
              │                        Waits for their OK before introducing
              │
              └── "Make intro"       → Sends a 3-way email (CC'd):
                                       - To: target contact + requester
                                       - CC: connector
                                       - Subject: "Alice intro: Bob ↔ Carol (Stripe)"
```

**Offer flow:** When a connector responds, an `IntroOffer` is created. The requester can accept or reject. Accepting one offer auto-rejects all others.

**Details:** [Intro Request & Offer System](./DATA_ACCESS.md#9-intro-request--offer-system)

---

## Tech Stack

| Layer      | Technology                                  |
|------------|---------------------------------------------|
| Frontend   | React 18, React Router 6, Vite, TypeScript  |
| Backend    | Express.js, TypeScript, Node.js             |
| Database   | PostgreSQL + Prisma ORM                     |
| Auth       | Google OAuth 2.0, Passport.js, JWT          |
| Email      | Resend (transactional email API)            |
| Enrichment | Apollo.io API (company + people data)       |
| AI         | OpenAI API (for AI features)                |
| Hosting    | Railway                                     |

---

## Database Schema (Entity Map)

```
┌──────────┐       ┌──────────────┐       ┌──────────────┐
│   User   │───┐   │   Contact    │───────│   Meeting    │
│          │   │   │   (per-user) │       │ (per-contact)│
│ email    │   │   │   email     │       │ title, date  │
│ name     │   │   │   name     │       │ duration     │
│ tokens   │   │   │   title    │       └──────────────┘
└──────┬───┘   │   │   company → ├──────────┐
       │       │   └──────────────┘          │
       │       │                             ▼
       │       │                     ┌──────────────┐
       │       │                     │   Company    │
       │       │                     │   (shared)   │
       │       │                     │   domain ⚷   │
       │       │                     │   industry   │
       │       │                     │   funding    │
       │       │                     └──────────────┘
       │       │
       │       ├── Relationship (userId + companyId → strengthScore)
       │       │
       │       ├── Tag → CompanyTag (private labels on companies)
       │       │
       │       ├── SavedView (filters + sorts + grouping)
       │       │
       │       ├── CalendarAccount (OAuth tokens, sync state)
       │       │
       │       ├── Notification (in-app + email)
       │       │
       │       └── Signal → SignalMatch (watchers on data changes)
       │
       ├── DirectConnection (1:1 peer sharing, from ↔ to)
       │
       ├── PendingInvite (invites for non-users)
       │
       ├── Space ← SpaceMember (group sharing)
       │     │
       │     └── IntroRequest ← IntroOffer (warm intro flow)
       │
       └── IntroRequest (can also be 1:1, not just in spaces)
```

**Key constraints:**
- Contact is unique per `(userId, email)` — each user has their own copy
- Company is unique per `domain` — shared across all users, enriched from Apollo
- Relationship is unique per `(userId, companyId)` — one strength score per user per company
- Tag is unique per `(userId, name)` — completely private

---

## Use Case Scenarios

### Scenario 1: Founder looking for investors

> "I'm raising a Series A. Who in my network knows someone at Sequoia?"

1. Connect Google Calendar → Introo finds all past meetings
2. Create a Space "Fundraising" with co-founders and advisors
3. Search for "Sequoia" in the combined Space reach
4. Someone in the Space has 3 contacts at Sequoia (names + titles visible, emails masked)
5. Request an intro → the connector gets notified
6. Connector sends a warm double-intro email → 3-way thread started

### Scenario 2: Sales team sharing leads

> "Our team of 5 SDRs needs to see who already knows contacts at target accounts."

1. Each team member connects their calendar
2. Manager creates a Space "Sales Team" and invites all 5
3. Combined reach: 2,000+ companies from all team members' meetings
4. Before cold-calling Acme Inc, check the Space → Sarah met with their VP Eng last month
5. Sarah can intro the SDR directly or ask the VP Eng for permission first

### Scenario 3: Personal CRM for a consultant

> "I want to track all my client relationships and see which ones are going cold."

1. Connect calendar → all client meetings imported automatically
2. Tag companies: "Active Client," "Past Client," "Prospect"
3. Create a View "Cold Clients" with filter: tag = "Active Client" + last contact > 3 months
4. Sort by last contact date → see who you haven't spoken to in a while
5. One-click email to re-engage through the platform

### Scenario 4: Job seeker leveraging their network

> "I'm looking for a product role at a growth-stage startup."

1. Connect calendar → see every company you've interacted with
2. Filter: industry = "Technology," employees = 50–200
3. Add a 1:1 Connection with a mentor who has a broader network
4. Browse the mentor's shared companies → find matches
5. Request an intro to the hiring manager at your target company

### Scenario 5: VC mapping portfolio connections

> "Which of our LPs and founders know people at companies in our pipeline?"

1. Create a Space "Deal Flow" with partners and associates
2. Each partner connects their calendar
3. Search pipeline company names in the combined reach
4. See which partner has the strongest connection (most meetings, most recent)
5. Partner makes the intro directly from the platform

---

## Background Processes

These run automatically without user interaction:

| Process                  | Frequency      | What it does                                              |
|--------------------------|----------------|-----------------------------------------------------------|
| Calendar sync            | Every 4 hours  | Re-fetches events, discovers new contacts, updates meetings |
| Contact enrichment       | After each sync | Enriches unenriched contacts via Apollo (with credit optimization) |
| Weekly digest email      | Every 7 days   | Sends network activity summary to all active users        |
| Token refresh            | On demand      | Refreshes expired Google OAuth tokens automatically       |
| User cache eviction      | Every 10 min   | Cleans up expired entries in the auth middleware cache     |

**Details:** [Background Cron Jobs](./DATA_ACCESS.md#5-background-cron-jobs)

---

## API Route Map

All routes are prefixed with their path and require authentication unless noted.

| Route prefix          | Purpose                              | Key endpoints                            |
|-----------------------|--------------------------------------|------------------------------------------|
| `/auth`               | Google OAuth login/callback/logout   | `GET /google`, `GET /google/callback`    |
| `/api/calendar`       | Calendar sync & account management   | `POST /sync`, `GET /accounts`            |
| `/api/relationships`  | User's contacts, companies, approval | `GET /contacts`, `POST /contacts/approve`|
| `/api/enrichment`     | Apollo enrichment control            | `POST /contacts-free`, `GET /progress`   |
| `/api/connections`    | 1:1 peer connections                 | `POST /`, `POST /:id/accept`, `GET /:id/reach` |
| `/api/spaces`         | Group network sharing                | `CRUD`, `GET /:id/reach`, `POST /:id/invite` |
| `/api/requests`       | Intro requests                       | `CRUD`, `PATCH /:id/status`              |
| `/api/offers`         | Intro offers (from connectors)       | `POST /`, `PATCH /:id/status`            |
| `/api/email`          | Send emails through platform         | `POST /contact`, `POST /double-intro`    |
| `/api/tags`           | Private company tags                 | `GET /`, `POST /`, `DELETE /:id`         |
| `/api/views`          | Saved filter/sort configurations     | `GET /`, `POST /`, `PATCH /:id`          |
| `/api/signals`        | Data change watchers                 | `CRUD`, `GET /matches`                   |
| `/api/notifications`  | In-app notifications                 | `GET /`, `POST /:id/read`               |
| `/api/users`          | User profile management              | `GET /me`, `PATCH /me`                   |
| `/api/ai`             | AI-powered features                  | Various                                  |

---

## Frontend Routes

| Path          | Component        | Auth required | Purpose                           |
|---------------|------------------|---------------|-----------------------------------|
| `/`           | LandingPage      | No            | Marketing landing page            |
| `/login`      | LoginPage        | No            | Sign in with Google               |
| `/docs`       | DocsPage         | No            | Product documentation (4 articles)|
| `/terms`      | TermsPage        | No            | Terms of service                  |
| `/privacy`    | PrivacyPage      | No            | Privacy policy                    |
| `/onboarding` | OnboardingPage   | Yes           | Calendar connect + contact review |
| `/home`       | AIHomePage       | Yes           | Main single-page application      |

The entire authenticated experience lives in `/home` — a single-page app with inline panels for company details, people, spaces, connections, intros, settings, and manual contact creation.

---

## Security Summary

| Concern                | How it's handled                                          |
|------------------------|-----------------------------------------------------------|
| Authentication         | Google OAuth 2.0 → JWT in httpOnly cookie (7-day expiry) |
| Token storage          | AES-256-GCM encryption at rest                           |
| Data isolation         | Every query scoped by `userId` from JWT                  |
| Email hiding           | Contact emails completely hidden in spaces & connections  |
| CSRF                   | SameSite=lax cookies (same-domain deployment)            |
| XSS                    | CSP headers, httpOnly cookies, HTML escaping in emails   |
| Rate limiting          | Global (1k/15min), auth (50/15min), email (20/hr/user)  |
| HTTPS                  | HSTS + redirect in production                            |
| Clickjacking           | X-Frame-Options: DENY                                    |

**Details:** [Security & Authentication](./DATA_ACCESS.md#7-security--authentication)
