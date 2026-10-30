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
| `npm test` | Unit + integration tests |
| `npm run test:unit` / `test:integration` / `test:e2e` | One test level (e2e builds the backend first) |
| `npm run lint` | ESLint + ruff |

## Testing

All JS tests use [Vitest](https://vitest.dev). None of them need a real Supabase project or network access.

| Level | Where | What it covers |
| --- | --- | --- |
| Unit | `apps/backend/test/unit`, `packages/shared/test`, `apps/frontend/src/**/*.test.ts` | URL checks, HTML extraction and escaping, auth middleware, env validation, zod contracts, the frontend API client |
| Integration | `apps/backend/test/integration` | The Express app in-process (supertest) against a fake Supabase server: every `/api/auth` route, email verification links, and the auth checks on room creation |
| E2E | `apps/backend/test/e2e` | Starts the built `dist/index.js` in production mode as its own process: signup → verify by email → login → create a room → refresh → logout, plus rate limiting |

`apps/backend/test/support/fake-supabase.ts` is an in-memory stand-in for the Supabase auth, database and storage HTTP APIs, so the real `supabase-js` client is exercised. Its `outbox` records the verification emails Supabase would send.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes to `main`. Its jobs are: lint and typecheck, unit, integration, e2e, build, and ruff for the AI service. For branch protection, make **CI passed** the required check; it fails if any other job fails.

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
