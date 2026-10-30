# LinkRoom

> The internet is single-player. LinkRoom makes every link multiplayer.

Paste a link or drop a PDF, share the room, and read, highlight, comment and get an AI group recap together. See [MASTER.md](MASTER.md) and [CHECKLIST.md](CHECKLIST.md).

## Repo layout

```
apps/
  frontend/   Next.js 16 + TypeScript + Tailwind v4     :3000
  backend/    Express 5 + TypeScript                     :4000
  ai/         Python FastAPI + Anthropic SDK (uv)        :8000
packages/
  shared/     zod schemas + types shared by frontend and backend
supabase/
  migrations/ SQL schema, RLS policies, storage bucket
```

```
browser ──► frontend ──► backend (rooms, extraction, PDF upload) ──► ai (Claude recap)
   │                         │
   └──── Supabase Realtime ◄─┴── Postgres + Storage
```

Cursors, scroll and reactions go browser to browser over Supabase Realtime. Highlights and comments are written straight to Supabase from the browser. Rooms and recaps are written by the backend with the service role key.

## Setup

Requirements: Node 20+, Python 3.12+, [uv](https://docs.astral.sh/uv/).

```bash
npm install              # all JS workspaces
npm run setup:ai         # Python deps for apps/ai

cp .env.example .env                                   # backend + ai
cp apps/frontend/.env.example apps/frontend/.env.local # frontend
```

Run the files in [supabase/migrations](supabase/migrations) in order (`0001`, then `0002`) in the Supabase SQL editor, then fill in the env files.

### Supabase Auth (email verification)

1. **Auth → Providers → Email**: turn on **Confirm email**; minimum password length 8.
2. **Auth → URL Configuration**: Site URL = the frontend URL. Add `http://localhost:4000/api/auth/verify` and `<production backend>/api/auth/verify` to **Redirect URLs**.
3. **Auth → Email Templates → Confirm signup**: make the link `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`.
4. **Auth → SMTP**: the built-in sender only mails project team members and is heavily rate-limited; set up custom SMTP (for example Resend) before the demo.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs frontend, backend and ai together |
| `npm run dev:frontend` / `dev:backend` / `dev:ai` | Runs one app |
| `npm run build` | Builds frontend (`.next`) and backend (`dist`) |
| `npm run typecheck` | TypeScript checks + ruff |
| `npm run lint` | ESLint + ruff |

## API

| Method | Path | Service |
| --- | --- | --- |
| `GET` | `/health` | backend, ai |
| `POST` | `/api/auth/signup` `{ email, password, name }` | backend: sends a verification email |
| `GET` | `/api/auth/verify?token_hash&type` | backend: email link target, redirects to `WEB_ORIGIN/login?verified=1` |
| `POST` | `/api/auth/resend-verification` `{ email }` | backend |
| `POST` | `/api/auth/login` `{ email, password }` | backend: returns `{ access_token, refresh_token, expires_at, user }`; 403 if unverified |
| `POST` | `/api/auth/refresh` `{ refresh_token }` | backend |
| `POST` | `/api/auth/logout` 🔒 | backend |
| `GET` | `/api/auth/me` 🔒 | backend |
| `POST` | `/api/rooms/link` `{ url }` 🔒 | backend |
| `POST` | `/api/rooms/text` `{ title?, text }` 🔒 | backend |
| `POST` | `/api/rooms/pdf` multipart `file` 🔒 | backend |
| `POST` | `/api/rooms/:id/recap` | backend → ai |
| `POST` | `/recap` | ai (internal) |

🔒 = needs `Authorization: Bearer <access_token>` from a verified account. Joining and reading rooms needs no login. Signup, login and resend share a limit of 10 requests per 15 minutes per IP.
