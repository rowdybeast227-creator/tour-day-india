# Tour de France India — Virtual Peloton

Backend + frontend for a community site where Indian cyclists register, log daily rides against the real Tour de France stage calendar, and compete on a leaderboard.

## Stack

- **Frontend**: static vanilla-JS pages in `frontend/` (no build step)
- **Backend**: Node.js + Express (`server/server.js`)
- **Database**: PostgreSQL (Supabase), accessed via `pg`
- **Auth**: server-side sessions (`express-session`, stored in Postgres via `connect-pg-simple`) with bcrypt-hashed passwords

## Running locally

```bash
cd server
npm install
node server.js
```

Then open **http://localhost:3000/**.

## Environment variables

Create `server/.env` (not committed — see `.gitignore`):

```
PORT=3000
SESSION_SECRET=<any long random string>
DATABASE_URL=<your Postgres connection string, e.g. from Supabase>
```

For Supabase specifically: Project Settings → Database → Connection string → "Transaction pooler" (recommended for serverless deployments like Vercel; a direct connection also works fine for local dev).

## Deploying on Vercel

- `api/index.js` exports the Express app as a Vercel serverless function
- `vercel.json` routes all requests to it (the app itself serves the static `frontend/` files and the `/api/*` routes)
- Set `SESSION_SECRET` and `DATABASE_URL` as environment variables in the Vercel project dashboard (never commit `.env`)
- Use the **pooled** connection string (not the direct one) for `DATABASE_URL` in production — serverless functions can spin up many concurrent instances, and a direct Postgres connection per instance will exhaust the database's connection limit quickly

## Project structure

```
frontend/   — home, login, register, about, instructions pages (static HTML/CSS/JS)
api/        — Vercel serverless function entry point
server/     — Express API + database
  db.js       — Postgres connection pool + schema (users, rides tables)
  auth.js     — session auth middleware
  server.js   — routes: register, login, logout, profile, rides, leaderboard
```

## API

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/register` | — | Create an account |
| POST | `/api/login` | — | Log in (email or username) |
| POST | `/api/logout` | session | End the session |
| GET | `/api/me` | session | Current user's profile |
| PUT | `/api/profile` | session | Update profile fields |
| POST | `/api/rides` | session | Submit/update today's ride (upsert per day) |
| GET | `/api/rides/me?date=YYYY-MM-DD` | session | Check if today's ride is already logged |
| GET | `/api/leaderboard` | — | Aggregated standings from submitted rides |
