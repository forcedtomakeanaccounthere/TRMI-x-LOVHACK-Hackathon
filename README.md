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

**To run locally, follow [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).** It uses a local Supabase in Docker and checks each step.

To use a cloud Supabase project instead, requirements are Node 22.14+, Python 3.12+ and [uv](https://docs.astral.sh/uv/):

```bash
npm install              # all JS workspaces
npm run setup:ai         # Python deps for apps/ai

cp .env.example .env                                     # backend + ai
grep '^NEXT_PUBLIC_' .env > apps/frontend/.env.local     # frontend, after filling in .env
```

Run the files in [supabase/migrations](supabase/migrations) in order (`0001`, then `0002`) in the Supabase SQL editor, and fill in `.env` before creating the frontend file.

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
| `npm run supabase:start` / `supabase:stop` | Starts / stops a local Supabase in Docker (needed by integration, e2e and db tests) |
| `npm test` | Unit + integration tests |
| `npm run test:unit` / `test:integration` / `test:e2e` | One test level (e2e builds the backend first) |
| `npm run test:db` | pgTAP tests for the database's row level security |
| `npm run lint` | ESLint + ruff |

## Testing

JS tests use [Vitest](https://vitest.dev). Integration, e2e and database tests run against a **real local Supabase** (Postgres, Auth, PostgREST, Storage and the Mailpit inbox, in Docker) with [supabase/migrations](supabase/migrations) applied. No cloud project or API keys needed:

```bash
npm run supabase:start   # first run downloads the Docker images; prints URLs and local keys
npm run test:db          # RLS policies
npm run test:integration
npm run test:e2e
npm run supabase:stop
```

[supabase/config.toml](supabase/config.toml) sets local Auth up like production: **Confirm email** on, minimum password length 8, the backend's `/api/auth/verify` as an allowed redirect, and the same "Confirm signup" template ([supabase/templates/confirmation.html](supabase/templates/confirmation.html)). Its rate limits are raised so the suites can sign up many users. After changing a migration, `npx supabase db reset` rebuilds the local database from scratch. Studio (the dashboard) is at http://127.0.0.1:54323 and the email inbox at http://127.0.0.1:54324.

| Level | Where | What it covers |
| --- | --- | --- |
| Unit | `apps/backend/test/unit`, `packages/shared/test`, `apps/frontend/src/**/*.test.ts` | URL checks, HTML extraction and escaping, auth middleware (with a mocked Supabase client), env validation, zod contracts, the frontend API client. No Supabase needed |
| Database | `supabase/tests/database` | pgTAP, as the `anon` and `authenticated` roles the browser uses: who can read and write each table and the `pdfs` bucket, and the input limits |
| Integration | `apps/backend/test/integration` | The Express app in-process (supertest) against the local Supabase: every `/api/auth` route, real verification emails, and room creation writing to Postgres and Storage |
| E2E | `apps/backend/test/e2e` | Starts the built `dist/index.js` in production mode as its own process and runs user stories over HTTP: new user (signup → verify → login → room → refresh → logout), returning user (login → text and PDF rooms → logout → login again), lost email (link expires → resend → verify → login), taken email (re-signup can't take over an account), plus the default rate limit |

`apps/backend/test/support/supabase.ts` reads the local URLs and keys from `supabase status`, opens verification links from the Mailpit inbox, and checks rows and files with the service role. Each run uses new email addresses, since the local database keeps data between runs. The backend reaches Supabase through a small pass-through proxy in that file, so a test can make one request fail on purpose (for example, a 500 from Auth during logout).

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes to `main`. Its jobs are: lint and typecheck, unit, database + integration + e2e (one job that starts the local Supabase once), build, and ruff for the AI service. For branch protection, make **CI passed** the required check; it fails if any other job fails.

## API

Interactive docs are generated when each service starts: backend at http://localhost:4000/docs (`/openapi.json`), AI service at http://localhost:8000/docs.

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
