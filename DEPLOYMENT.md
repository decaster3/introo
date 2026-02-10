# Deployment Guide

This guide covers deploying Spaces to production.

## Quick Deploy Options

### Option 1: Railway (Recommended)

Railway provides the easiest deployment experience with automatic builds and managed PostgreSQL.

#### Steps:

1. **Create a Railway account** at [railway.app](https://railway.app)

2. **Create a new project** and add a PostgreSQL database:
   - Click "New Project" → "Provision PostgreSQL"
   - Copy the `DATABASE_URL` from the database settings

3. **Deploy the Backend**:
   ```bash
   cd backend
   railway login
   railway init
   railway up
   ```
   
   Set environment variables in Railway dashboard:
   - `DATABASE_URL` - (from PostgreSQL service)
   - `JWT_SECRET` - Generate with: `openssl rand -hex 32`
   - `ENCRYPTION_KEY` - Generate with: `openssl rand -hex 32`
   - `GOOGLE_CLIENT_ID` - From Google Cloud Console
   - `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
   - `GOOGLE_CALLBACK_URL` - `https://your-backend.railway.app/auth/google/callback`
   - `FRONTEND_URL` - `https://your-frontend.railway.app`
   - `NODE_ENV` - `production`

4. **Deploy the Frontend**:
   ```bash
   cd frontend
   railway init
   railway up
   ```

5. **Update Google OAuth**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Update authorized redirect URIs to include your Railway backend URL

---

### Option 2: Docker Compose (Self-hosted)

For VPS or self-hosted deployment.

#### Prerequisites:
- Docker and Docker Compose installed
- A domain name (optional but recommended)
- SSL certificate (use Let's Encrypt/Caddy)

#### Steps:

1. **Clone and configure**:
   ```bash
   git clone <your-repo>
   cd spaces
   cp .env.production.example .env.production
   ```

2. **Edit `.env.production`** with your values:
   ```env
   POSTGRES_PASSWORD=your-secure-password
   JWT_SECRET=your-jwt-secret-min-32-chars
   ENCRYPTION_KEY=your-64-char-hex-string
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   GOOGLE_CALLBACK_URL=https://yourdomain.com/auth/google/callback
   FRONTEND_URL=https://yourdomain.com
   ```

3. **Deploy**:
   ```bash
   docker-compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```

4. **Run database migrations**:
   ```bash
   docker-compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
   ```

5. **Set up reverse proxy** (recommended):
   Use Caddy, Nginx, or Traefik for SSL termination.

---

### Option 3: Vercel (Frontend) + Railway (Backend)

Best for maximum performance on the frontend.

#### Frontend on Vercel:

1. Connect your GitHub repo to Vercel
2. Set root directory to `frontend`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add environment variable:
   - `VITE_API_URL` = `https://your-backend.railway.app`

#### Backend on Railway:
Follow Railway steps above.

---

## Environment Variables Reference

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT signing (min 32 chars) |
| `ENCRYPTION_KEY` | Yes | 64-char hex for token encryption |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | Yes | OAuth callback URL |
| `FRONTEND_URL` | Yes | Frontend URL for CORS/redirects |
| `NODE_ENV` | No | Set to `production` for production |
| `PORT` | No | Server port (default: 3001) |

### Frontend

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_USE_MOCK` | No | Set to `false` for production |
| `VITE_API_URL` | No | Backend API URL (if different origin) |

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the **Google Calendar API**
4. Go to **APIs & Services** → **Credentials**
5. Create **OAuth 2.0 Client ID**:
   - Application type: Web application
   - Authorized JavaScript origins: `https://yourdomain.com`
   - Authorized redirect URIs: `https://yourdomain.com/auth/google/callback`
6. Copy Client ID and Client Secret to your environment variables

---

## SSL/HTTPS

For production, always use HTTPS. Options:

### Caddy (Automatic SSL)
```
yourdomain.com {
    reverse_proxy frontend:80
}
```

### Let's Encrypt + Nginx
Use certbot with nginx plugin.

### Cloudflare
Use Cloudflare as CDN with Full SSL mode.

---

## Monitoring

The backend exposes a health check endpoint at `/health` that returns:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "database": "connected"
}
```

Use this for:
- Container health checks
- Load balancer health probes
- Uptime monitoring services

---

## Troubleshooting

### Database connection issues
- Check `DATABASE_URL` format
- Ensure PostgreSQL is running and accessible
- Check network/firewall settings

### OAuth errors
- Verify callback URL matches exactly
- Check client ID/secret are correct
- Ensure Google Calendar API is enabled

### Calendar sync "expired" error
- User needs to re-authenticate with Google
- Refresh tokens may have been revoked

---

## Scaling

For high traffic:

1. **Database**: Use managed PostgreSQL (Railway, Supabase, AWS RDS)
2. **Backend**: Run multiple instances behind a load balancer
3. **Frontend**: Use CDN (Cloudflare, Vercel Edge)
4. **Caching**: Add Redis for session/data caching
