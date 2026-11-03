<div align="center">

# LinkRoom
**The internet is single-player. LinkRoom makes every link multiplayer.**

**[API documentation](https://link-room-swaq.onrender.com/docs/)** · **[Try it as a guest](#try-it-in-one-click)** · **[Watch Demo](https://youtu.be/SGm599w1M3U)**

![LinkRoom landing page](docs/images/landing-hero.jpg)

Paste any article or drop a PDF, share one link, then highlight, comment and follow each other as you read, ask queries from AI - chatbox & AI lens, have a voice chat using Huddle, and finish with an AI recap of what the group cared about.

Built for the **TRMI x LOVHACK Hackathon**.

</div>

## Try it in one click

The sign-in page has **Judging? Sign in as a guest**: two seeded accounts, no email needed. Sign in as one, or as both in two windows (one private) to see live cursors, follow, laser focus and huddles between them.

| Account | Email | Password |
| --- | --- | --- |
| Ada (demo), owns the demo rooms | `judge.ada@linkroom.demo` | `LinkRoom-demo-2026` |
| Ben (demo), reads along with Ada | `judge.ben@linkroom.demo` | `LinkRoom-demo-2026` |

Their dashboard has **Robot Perception 101 · demo room** with two attached sources, highlights and comments, an @mention, a discussion with replies and reactions, notebook entries, a Studio mind map, quiz and flashcards, and a finished voice huddle with its transcript and AI notes. The data comes from `npm run seed:demo -w apps/backend` (see [Scripts](#scripts)).

## The problem

We share a link, everyone reads it alone, and the conversation happens somewhere else, in screenshots and "which paragraph?" messages. LinkRoom puts the people back on the page.

https://github.com/user-attachments/assets/d548839b-0f62-49d9-bd30-6cf45f9b7878

*Watch on [YouTube](https://youtu.be/SGm599w1M3U) if the video preview fails to load.*


## How it works

Three steps, no onboarding:

1. **Paste a link** [Notion, Youtube video, Substack, Medium article, Wikipedia, any blogs] or **Upload a PDF/PPT/DOCX/Markdown/txt** file (up to 20 MB).
2. **Share the room** with one short link or QR code. Guests just type a name, no account needed.
3. **Read together** with live cursors, highlights, comments, reactions and follow mode. When you are done, the AI recaps the room.
4. Use **advanced AI features** like AI lens, chatbox, or **create artifacts based on uploaded resources** like Mindmaps, Quiz, Flashcards, Infographics.

![How it works](docs/images/how-it-works.jpg)

## Features

### Inside a room

| | |
| --- | --- |
| ![Five readers' live cursors in one room](docs/images/live-cursors.jpg) | **Live cursors.** Everyone in the room sees each other's named cursors move over the text in real time. Click a reader to jump to exactly where they are, or follow them. |
| ![Laser focus](docs/images/laser-focus.jpg) | **Laser focus.** "Everyone look here" pulls the whole room to your paragraph and turns your pointer into a laser ("Arnav · look here"). When it ends, everyone goes back to where they were reading. |
| ![Room with AI chat](docs/images/room-ai-chat.jpg) | **AI chat with sources.** Ask anything about the room's sources (PDFs, web pages, docs, Markdown, text). Answers cite the exact passages. |
| ![AI lens](docs/images/ai-lens.jpg) | **AI lens.** Drag over any part of the page, even a diagram, and ask about it. |
| ![While you were away](docs/images/while-you-were-away.jpg) | **While you were away.** Come back to a short AI summary of what others highlighted and discussed. |
| ![Follow mode and Studio](docs/images/follow-mode-studio.jpg) | **Follow mode + Studio.** "Everyone look here" brings the whole room to your paragraph. Studio makes summaries, quizzes, flashcards, mind maps and infographics. |
| ![Mind map](docs/images/mind-map.jpg) | **Mind maps** from any mix of sources in the room. |
| ![Discussion](docs/images/discussion.jpg) | **Discussion** with @mentions, replies and reactions, right beside the text. |
| ![Notebook](docs/images/notebook.jpg) | **Room notebook.** Notes, passages and images everyone in the room can see. |
| ![Voice huddle](docs/images/huddle-call.jpg) | **Voice huddles.** Start a call with the whole room or pick people for a private talk, right in the Sources rail. Speaking rings, mute, invite, leave or end for all; viewers join to listen. Built on LiveKit. |
| ![Huddle transcript](docs/images/huddle-transcript.jpg) | **Live captions and transcript.** What people say shows as subtitles over the reading and builds a transcript as they talk (Chrome and Edge speech recognition, in English or Hindi). Download it as .txt or .md. |
| ![Huddle notes](docs/images/huddle-notes.jpg) | **Huddle notes.** One click turns the conversation into a summary, decisions, action items with owners, open questions and key points. Each point links to the passage people were reading when it was said. |
| ![Room settings](docs/images/room-settings.jpg) | **Roles and access.** Owner, admin, editor and viewer roles, guest access, and AI chat permissions. |

### Four verbs, one page

| Highlight | Discuss |
| --- | --- |
| ![Highlight](docs/images/verbs-highlight.jpg) | ![Discuss](docs/images/verbs-discuss.jpg) |

Highlight, Discuss, Follow and Recap. Each reader gets one colour for their cursor, avatar and highlights.

![Features](docs/images/features.jpg)

### Dashboard

Your rooms, groups, calendar and the people you read with, in one place.

![Dashboard](docs/images/dashboard.jpg)

| Calendar and paused rooms | Groups and people |
| --- | --- |
| ![Calendar](docs/images/dashboard-calendar.jpg) | ![Groups and people](docs/images/dashboard-people-groups.jpg) |

| New room | New group |
| --- | --- |
| ![New room](docs/images/new-room.jpg) | ![New group](docs/images/new-group.jpg) |

### Made for every reading circle

Study groups, product teams, friends and classrooms.

![Use cases](docs/images/use-cases.jpg)

| Sign in | Call to action |
| --- | --- |
| ![Sign in](docs/images/sign-in.jpg) | ![Make your next read multiplayer](docs/images/landing-cta.jpg) |

## Tech stack

- **Frontend:** Next.js 16, TypeScript, Tailwind v4
- **Backend:** Express 5, TypeScript
- **AI service:** Python, FastAPI, Anthropic SDK
- **Data and realtime:** Supabase (Postgres, Auth, Storage, Realtime)
- **Voice huddles:** LiveKit
- **Tooling:** Turborepo, Vitest, pgTAP, ruff, pytest

See [MASTER.md](MASTER.md) and [CHECKLIST.md](CHECKLIST.md) for the full plan.

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
npm run setup:playwright # install Playwright Chromium browser & OS deps

cp .env.example .env                                     # backend + ai
grep '^NEXT_PUBLIC_' .env > apps/frontend/.env.local     # frontend, after filling in .env
```

Run the files in [supabase/migrations](supabase/migrations) in order (`0001` to `0012`) in the Supabase SQL editor, and fill in `.env` before creating the frontend file.

### Email verification

The backend sends the verification email itself, with nodemailer over your SMTP server. Supabase only creates the user and the one-time token (admin `generateLink`), so its email templates, redirect URLs and SMTP settings are not used.

1. **Supabase → Auth → Providers → Email**: turn on **Confirm email**; minimum password length 8.
2. **SMTP** in `.env` (required in production; in development it defaults to the local Supabase inbox). For Gmail, turn on 2-Step Verification, create an [app password](https://myaccount.google.com/apppasswords), then:

   ```bash
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=you@gmail.com
   SMTP_PASS=<16-character app password>
   MAIL_FROM="LinkRoom <you@gmail.com>"
   ```

   Any SMTP provider works the same way (Resend: `smtp.resend.com`, port 465, user `resend`, the API key as password, and a `MAIL_FROM` on your verified domain).
3. **`API_PUBLIC_URL`** = the public backend URL, since the emailed link points at `$API_PUBLIC_URL/api/auth/verify`, and **`WEB_ORIGIN`** = the frontend URL, where that link sends the user back to: `/login?verified=1&email=…`, with the email filled in, ready to sign in.

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
| `npm run seed:demo -w apps/backend` | Creates the two guest-judge accounts (already verified) and fills a demo room through the running backend: sources, marks, comments, chat, notebook, Studio artifacts and a huddle with AI notes. Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; set `SEED_API_URL` to seed a deployed backend. Safe to run again. |

## Testing

JS tests use [Vitest](https://vitest.dev). Integration, e2e and database tests run against a **real local Supabase** (Postgres, Auth, PostgREST, Storage and the Mailpit inbox, in Docker) with [supabase/migrations](supabase/migrations) applied. No cloud project or API keys needed:

```bash
npm run supabase:start   # first run downloads the Docker images; prints URLs and local keys
npm run test:db          # RLS policies
npm run test:integration
npm run test:e2e
npm run supabase:stop
```

[supabase/config.toml](supabase/config.toml) sets local Auth up like production: **Confirm email** on, minimum password length 8, and Mailpit's SMTP port (54325), which is where the backend sends its emails in development and tests. Its rate limits are raised so the suites can sign up many users. After changing a migration, `npx supabase db reset` rebuilds the local database from scratch. Studio (the dashboard) is at http://127.0.0.1:54323 and the email inbox at http://127.0.0.1:54324.

| Level | Where | What it covers |
| --- | --- | --- |
| Unit | `apps/backend/test/unit`, `packages/shared/test`, `apps/frontend/src/**/*.test.ts` | URL checks, HTML extraction and escaping, auth middleware (with a mocked Supabase client), env validation, zod contracts, the frontend API client. No Supabase needed |
| Database | `supabase/tests/database` | pgTAP, as the `anon` and `authenticated` roles the browser uses: who can read and write each table and the `pdfs` bucket, and the input limits |
| Integration | `apps/backend/test/integration` | The Express app in-process (supertest) against the local Supabase: every `/api/auth` route, real verification emails, and room creation writing to Postgres and Storage |
| E2E | `apps/backend/test/e2e` | Starts the built `dist/index.js` in production mode as its own process and runs user stories over HTTP: new user (signup → verify → login → room → refresh → logout), returning user (login → text and PDF rooms → logout → login again), lost email (link expires → resend → verify → login), taken email (re-signup can't take over an account), plus the default rate limit |

`apps/backend/test/support/supabase.ts` reads the local URLs and keys from `supabase status`, opens verification links from the Mailpit inbox, and checks rows and files with the service role. Each run uses new email addresses, since the local database keeps data between runs. The backend reaches Supabase through a small pass-through proxy in that file, so a test can make one request fail on purpose (for example, a 500 from Auth during logout).

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes to `main`. Its jobs are: lint and typecheck, unit, database + integration + e2e (one job that starts the local Supabase once), build, and ruff plus pytest for the AI service. For branch protection, make **CI passed** the required check; it fails if any other job fails.

## API

Interactive docs for the deployed backend: **https://link-room-swaq.onrender.com/docs/**. They're generated when each service starts, so locally they're at http://localhost:4000/docs (`/openapi.json`) for the backend and http://localhost:8000/docs for the AI service.

| Method | Path | Service |
| --- | --- | --- |
| `GET` | `/health` | backend, ai |
| `POST` | `/api/auth/signup` `{ email, password, name }` | backend: sends a verification email |
| `GET` | `/api/auth/verify?token_hash&type` | backend: email link target, redirects to `WEB_ORIGIN/login?verified=1&email=…` |
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
