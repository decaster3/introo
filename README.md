# Introo - Warm Intros from Your Network

**Domain:** introo.app

A professional networking platform that helps communities facilitate warm introductions. Connect your calendar to discover your network, and help others get intros to companies they want to reach.

## Architecture

```
spaces/
├── frontend/          # React + Vite frontend
├── backend/           # Express + TypeScript API
└── docker-compose.yml # PostgreSQL + services
```

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Google Cloud Console project with Calendar API enabled

## Setup

### 1. Google OAuth Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the **Google Calendar API**
4. Go to **APIs & Services > Credentials**
5. Configure OAuth consent screen (External, add test users)
6. Create **OAuth 2.0 Client ID** (Web application)
7. Add authorized redirect URI: `http://localhost:3001/auth/google/callback`
8. Copy Client ID and Client Secret

### 2. Environment Setup

```bash
# Backend environment
cp backend/.env.example backend/.env

# Edit backend/.env with your values:
# - GOOGLE_CLIENT_ID
# - GOOGLE_CLIENT_SECRET
# - JWT_SECRET (generate a random string)
```

### 3. Start Database

```bash
# Start PostgreSQL
docker-compose up -d postgres

# Wait for it to be ready
docker-compose logs -f postgres
```

### 4. Install Dependencies & Setup Database

```bash
# Backend
cd backend
npm install
npx prisma generate
npx prisma db push

# Frontend
cd ../frontend
npm install
```

### 5. Run Development Servers

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend  
cd frontend
npm run dev
```

Open http://localhost:5173

## Development with Mock Data

To run frontend without backend (using mock data):

```bash
cd frontend
VITE_USE_MOCK=true npm run dev
```

## Production Deployment

```bash
# Build and run all services
docker-compose up --build
```

## API Endpoints

### Authentication
- `GET /auth/google` - Initiate Google OAuth
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/me` - Get current user
- `POST /auth/logout` - Logout

### Calendar
- `POST /api/calendar/sync` - Sync calendar contacts
- `GET /api/calendar/status` - Get sync status

### Users
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get user by ID
- `GET /api/users/me/stats` - Get current user stats

### Relationships
- `GET /api/relationships` - Get all relationships
- `GET /api/relationships/mine` - Get my relationships
- `GET /api/relationships/companies` - Get companies
- `GET /api/relationships/contacts` - Get my contacts

### Intro Requests
- `GET /api/requests` - List all requests
- `GET /api/requests/:id` - Get request by ID
- `POST /api/requests` - Create new request
- `PATCH /api/requests/:id/status` - Update request status
- `GET /api/requests/user/mine` - Get my requests

### Intro Offers
- `POST /api/offers` - Create offer
- `PATCH /api/offers/:id/status` - Accept/reject offer
- `GET /api/offers/mine` - Get my offers

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, React Router
- **Backend**: Express.js, TypeScript, Prisma ORM
- **Database**: PostgreSQL
- **Auth**: Google OAuth 2.0, JWT
- **Calendar**: Google Calendar API
