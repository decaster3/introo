# Railway Deployment Setup

## Architecture

```
                    ┌──────────────┐
                    │   Postgres   │
                    │  (Railway)   │
                    │              │
                    │ postgres-    │
                    │ volume-heof  │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     ┌────────┴────────┐     ┌──────────┴───────┐
     │    backend       │     │    frontend       │
     │ api.introo.app   │     │  introo.app       │
     │ Node.js/Express  │     │  Vite (static)    │
     │ Port 8080        │     │                   │
     └─────────────────┘     └──────────────────┘
```

## Services

### Backend — `api.introo.app`
- **Runtime**: Node.js v20 (Dockerfile-based)
- **Port**: 8080 (Railway-assigned via `PORT` env var)
- **Healthcheck**: `GET /health` (returns DB connectivity status)
- **Start command**: `prisma migrate deploy && node dist/index.js` (via `start.sh`)
- **Build**: `prisma generate && tsc` (npm run build)
- **Branch**: deploys from `main`

### Frontend — `introo.app`
- **Runtime**: Static site (Vite build)
- **Build**: `tsc && vite build`
- **Output**: `dist/` directory
- **Branch**: deploys from `main`

### Postgres
- **Provider**: Railway managed Postgres
- **Volume**: `postgres-volume-heof`
- **Internal host**: `postgres.railway.internal:5432`
- **Database name**: `railway`

## Environment Variables

### Backend (10 service variables)

| Variable | Description |
|---|---|
| `APOLLO_API_KEY` | Apollo.io API key for contact/company enrichment |
| `DATABASE_URL` | Postgres connection string (Railway internal) |
| `ENCRYPTION_KEY` | AES-256 key for encrypting OAuth tokens at rest |
| `FRONTEND_URL` | `https://introo.app` — used for CORS, redirects, email links |
| `GOOGLE_CALLBACK_URL` | `https://api.introo.app/auth/google/callback` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `JWT_SECRET` | Secret for signing JWT auth tokens |
| `NODE_ENV` | `production` |
| `OPENAI_API_KEY` | OpenAI key for AI features |

Plus 8 Railway-added variables (PORT, RAILWAY_*, etc.)

### Frontend (4 service variables)

| Variable | Description |
|---|---|
| `FRONTEND_URL` | `https://introo.app` |
| `GOOGLE_CALLBACK_URL` | `https://api.introo.app/auth/google/callback` |
| `NODE_ENV` | `production` |
| `VITE_API_URL` | `https://api.introo.app` — API base URL used by frontend |

Plus 8 Railway-added variables.

### Postgres (auto-configured by Railway)

`DATABASE_URL`, `DATABASE_PUBLIC_URL`, `PGDATA`, `PGDATABASE`, `PGHOST`,
`PGPASSWORD`, `PGPORT`, `PGUSER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`,
`POSTGRES_USER`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, `SSL_CERT_DAYS`

## Domains

| Service | Domain |
|---|---|
| Backend | `api.introo.app` |
| Frontend | `introo.app` |

## Key Deployment Notes

### Healthcheck
- Path: `/health`
- Retry window: 5 minutes
- The `/health` endpoint is registered **before** all middleware (HTTPS redirect,
  CORS, rate limiting) because Railway's internal healthcheck uses plain HTTP
  without `x-forwarded-proto`.

### Database Migrations
- Production uses `prisma migrate deploy` (safe, only applies recorded migrations).
- Never use `prisma db push` in production — it can drop columns.
- New schema changes require a migration file in `backend/prisma/migrations/`.
- If a migration was applied via `db push` locally, create the migration file
  manually and run `prisma migrate resolve --applied <name>` on the local DB.

### Trust Proxy
- `app.set('trust proxy', 1)` is configured for Railway's reverse proxy.
- Required for: correct client IPs in rate limiting, `req.secure` detection,
  secure cookie setting.

### Cookies
- `sameSite: 'lax'` — same-domain deployment (frontend and backend share `introo.app`).
- `secure: true` in production (HTTPS only).
- `httpOnly: true` — JWT token not accessible via JavaScript.

### Email (disabled)
- Email service (`services/email.ts`) exists but is disabled in `index.ts`.
- Routes commented out, welcome email commented out, weekly digest cron removed.
- The service gracefully no-ops when `RESEND_API_KEY` is not set.
- To re-enable: uncomment imports in `index.ts` and `routes/auth.ts`,
  add `RESEND_API_KEY` and `RESEND_FROM_EMAIL` env vars on Railway.

### Enrichment (Apollo.io)
- Uses paid Apollo endpoints: `/people/match` (1 credit) and `/organizations/enrich` (1 credit).
- Cross-user caching: contacts and companies enriched by any user are cached globally.
- "Known no-match" cache: contacts previously attempted with no Apollo data are skipped.
- DEV mode (`NODE_ENV !== 'production'`): limited to 5 companies + 5 people per run.
- Production: no limits, all contacts/companies enriched in one pass.

### Google OAuth
- `prompt: 'select_account'` forces account chooser on every login.
- Callback URL must match exactly in Google Cloud Console and `GOOGLE_CALLBACK_URL` env var.
- Scopes: `profile`, `email`, `calendar.readonly`.

## Pre-Deployment Checklist

Before pushing to `main`:

1. `npx tsc --noEmit` passes in both `backend/` and `frontend/`
2. New Prisma schema changes have a migration file
3. No hardcoded `localhost` URLs in production code paths
4. Environment variables documented if new ones are added
5. Test locally with `NODE_ENV=production` if touching auth/cookies/security
