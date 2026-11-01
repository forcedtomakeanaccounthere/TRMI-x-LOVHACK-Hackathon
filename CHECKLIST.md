# LinkRoom: Build Checklist

Phase-by-phase tasks for the whole project. Inside each phase, tasks are split by area so that each teammate can pick their own part:

| Tag | Area | Default owner (team of 4) |
| --- | --- | --- |
| **BE** | Backend: API routes, database, storage, security | B |
| **FE** | Frontend: pages, components, layout, styling | C / D |
| **RT** | Realtime: presence, broadcast, row changes | A |
| **AI** | AI integration: Claude recap and Ask AI | C |
| **OPS** | Setup, env vars, deploys | B |
| **QA** | Testing and verification | Everyone, led by D |
| **PM** | Product, demo, submission | D |

Rules:

- Tick a box only when the task is merged to `main` **and** works on the deployed URL.
- `[*]` means the frontend part is built and merged, but not yet checked on the deployed URL. Change it to `[x]` once it is.
- Finish every P0 phase before any P1 work. P2 (Phase 8) starts only if Phases 1–7 are stable by Sun 4 PM IST.
- Each phase ends with a **Done when** test. Do not move on until it passes.
- Feature freeze at **Sun 8 PM IST**. Submit by **Mon 1:30 AM IST**.

See [MASTER.md](MASTER.md) for the idea, stack and UI design, and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for code samples.

## Overview

| Phase | Name | Time (IST) | Priority |
| --- | --- | --- | --- |
| 0 | Before kickoff | Until Sat 7:30 PM | Prep |
| 1 | Setup | Sat 7:30 – 9 PM | P0 |
| 2 | Link rooms | Sat 9 PM – Sun 1 AM | P0 |
| 3 | Realtime core | Sun 1 – 7 AM | P0 |
| 4 | PDF rooms | Sun 7 AM – 12 PM | P0 |
| 5 | Wow features | Sun 12 – 4 PM | P1 |
| 6 | Polish | Sun 4 – 8 PM | P1 |
| D | Dashboard (`/dashboard`) | Alongside Phase 6 | P1 |
| W | Link rooms workspace (`/r/[id]`) | Alongside Phases 3–6 | P1 |
| X | Room extras: huddle, focus, notebook, catch-up, mentions, minimap | After the workspace | P1 / P2 |
| 7 | Test and ship | Sun 8 PM – Mon 1:30 AM | Ship |
| 8 | Stretch | Only if time is left | P2 |

---

## Phase 0: Before kickoff (no app code)

**PM**
- [ ] Every teammate applies before **Sat Oct 31, 10:29 AM IST**
- [ ] Everyone joins the trmi Discord
- [ ] Decide team size and assign roles A, B, C, D (see MASTER.md section 8)
- [ ] Final name, tagline and logo (placeholder: LinkRoom)
- [ ] Pick 5 demo links (Wikipedia, MDN, a Paul Graham essay, a popular blog, a news article) and 2 demo PDFs (arXiv papers)
- [ ] Test that each demo link is readable in Firefox Reader View (a good proxy for Readability)

**OPS**
- [ ] Accounts ready: GitHub, Vercel, Supabase, Anthropic Console
- [ ] Anthropic API key created and a monthly spending limit set
- [ ] Every teammate has push access to the GitHub repo

**FE / Design**
- [ ] Rough wireframes for: landing page, room (desktop), room (mobile), comment panel, recap panel
- [ ] Confirm the colour tokens and fonts from MASTER.md section 6

**Done when:** everyone has applied, roles are assigned, and demo content is chosen.

---

## Phase 1: Setup (Sat 7:30 – 9 PM IST)

**PM**
- [ ] Read the official rules and judging criteria at kickoff; update MASTER.md if anything changes
- [ ] Confirm the Devpost submission fields

The repo is a monorepo (see README): `apps/frontend` (Next.js), `apps/backend` (Express, all `/api/*` routes), `apps/ai` (FastAPI recap), `packages/shared` (zod contracts). Items marked *(in repo)* are written; tick them once they are merged and work on the deployed URL.

**OPS**
- [ ] Monorepo scaffold: frontend, backend, ai, shared, turbo scripts *(in repo)*
- [ ] `shadcn init` in `apps/frontend`; add components: button, input, dialog, popover, tooltip, tabs, sheet, sonner (toasts), avatar, skeleton, scroll-area
- [ ] Root `.env` from `.env.example` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_PUBLIC_URL`, `WEB_ORIGIN`, `AI_SERVICE_URL`, `ANTHROPIC_API_KEY`) and `apps/frontend/.env.local` (`NEXT_PUBLIC_*`); both gitignored *(example in repo)*
- [ ] Backend validates env at boot and refuses to start in production without Supabase keys *(in repo)*
- [ ] Deploy frontend to Vercel, backend and ai to a Node/Python host; add the same env vars there
- [ ] First deploy succeeds

**BE**
- [ ] Create the Supabase project (region closest to the team, e.g. Mumbai)
- [ ] Run `supabase/migrations/0001_init.sql`, `0002_auth_and_phase1.sql`, `0003_comments_highlight_idx.sql`, `0004_browser_write_checks.sql`, `0005_room_status_and_visits.sql`, `0006_pdf_text.sql`, `0007_dashboard.sql`, `0008_room_top_members.sql` then `0009_recap_requested_by.sql` in the SQL editor *(in repo)*
  - tables `rooms`, `highlights`, `comments`, `recaps`; realtime publication; RLS (public select, anonymous insert on highlights and comments only)
  - `pdfs` bucket: public read, 20 MB limit, `application/pdf` only
  - length checks: quote ≤ 1,000, comment body ≤ 2,000, author name ≤ 40
  - `rooms.created_by` → `auth.users`
- [ ] `apps/backend/src/lib/supabase.ts`: `supabaseAdmin()` (service role, server only) and `supabaseAuth()` (anon key, fresh per request) *(in repo)*
- [ ] `apps/frontend/src/lib/supabase.ts`: browser client with the anon key *(in repo)*

**BE: Auth (signup, login, email verification)**
- [ ] `POST /api/auth/signup` sends a verification email; same reply for existing emails *(in repo)*
- [ ] `GET /api/auth/verify` (email link target) verifies, then redirects to `WEB_ORIGIN/login?verified=1|0` *(in repo)*
- [ ] `POST /api/auth/resend-verification`, `/login` (403 until verified), `/refresh`, `/logout`; `GET /api/auth/me` *(in repo)*
- [ ] `requireAuth` middleware (Bearer token, verified email) on room creation (`/api/rooms/link`, `/text`, `/pdf`); joining and reading rooms stays login-free *(in repo)*
- [ ] Rate limit: 10 auth requests per 15 min per IP *(in repo)*
- [ ] Verification emails sent by the backend with nodemailer (Supabase `generateLink` makes the token) *(in repo)*
- [ ] Supabase dashboard: Confirm email ON; production `.env` has `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` (e.g. a Gmail app password) and the public `API_PUBLIC_URL`

**FE**
- [*] Fonts with `next/font` *(in repo, changed from the original Inter / Source Serif 4 / JetBrains Mono plan: Cormorant Garamond for display and reading, Cinzel for eyebrows, Manrope for UI, Geist Mono for code; update MASTER.md section 6 to match)*
- [*] Colour tokens in `globals.css` for light and dark, plus the 8 person colours *(tokens in repo; the 8 person colours live in `PRESENCE_COLORS` in `packages/shared/src/realtime.ts`, not yet as CSS tokens)*
- [*] Theme provider with system default and a toggle *(in repo: no-flash inline script, `useTheme`, animated toggle with a circular reveal)*
- [*] Empty landing page with the hero text *(in repo, and well past empty: full landing page, see Phase 6)*

**QA**
- [ ] Live Vercel URL loads in light and dark mode
- [ ] Unit, integration and e2e tests pass (`npm test`, `npm run test:e2e`) *(in repo)*
- [ ] CI workflow runs on every PR; **CI passed** set as a required check on `main` (GitHub → Settings → Branches)

**Done when:** the live Vercel URL loads, Supabase tables exist, and a new account can sign up, verify by email and log in.

---

## Phase 2: Link rooms (Sat 9 PM – Sun 1 AM IST) · P0

**BE** (all in `apps/backend/src/lib/extract.ts` and `routes/rooms.ts`)
- [ ] `isPrivateHost()` blocks `localhost`, `*.localhost`, `127.*`, `10.*`, `172.16–31.*`, `192.168.*`, `169.254.*`, `100.64/10`, `0.*`, `::1`, `::`, `fc00::/7`, `fe80::/10`, NAT64 and IPv4-mapped IPv6 in any notation (checked with `net.BlockList`) *(in repo)*
- [ ] `POST /api/rooms/link`: accept only `http`/`https`, reject private hosts, and reject hostnames whose DNS resolves to a private address *(in repo)*
- [ ] Follow redirects by hand (max 5) and re-check every hop, so a redirect can't reach a private address *(in repo)*
- [ ] Fetch with a browser-like User-Agent and one 10 s deadline covering DNS, every redirect and the body; 422 on error status, non-HTML response or pages over 5 MB *(in repo)*
- [ ] Run Readability on the HTML; return 422 with a friendly message if there is no content or under 200 characters of text (JS-only sites) *(in repo)*
- [ ] Sanitize with DOMPurify; also drop `style`, `class`, forms and iframes so the page can't restyle or overlay the room *(in repo)*
- [ ] `addBlockIds()`: add `data-block="b0"…` to `p, h1–h6, li, blockquote, pre, figure` *(in repo)*
- [ ] Make relative image (`src`, `srcset`) and link URLs absolute; `srcset` URLs may contain commas; links open in a new tab with `rel="noopener noreferrer nofollow"`, in-page `#` links stay as they are; `javascript:` links removed *(in repo)*
- [ ] Insert the room with `nanoid(8)` and return `{ id }`; `source_url` is the final URL after redirects *(in repo)*
- [ ] `POST /api/rooms/text`: create a room from pasted text (split by blank lines into `<p data-block>`); blank text is a 400 *(in repo)*
- [ ] HTML-escape pasted text (`&`, `<`, `>`, `"`, `'`) before wrapping it in `<p>`, so it always shows as plain text *(in repo)*
- [ ] Unit tests for redirects, DNS to a private IP, non-HTML, oversized pages, JS-only shells and link rewriting *(in repo)*
- Known limit: DNS is checked before the fetch, so a DNS-rebinding attack could still slip through. Good enough for the hackathon; say so in the README.
- The backend runs on a Node host (not a Vercel function), so the `jsdom` → `linkedom` size switch is not needed.

**FE**
- [*] `LinkInput` on the landing page: autofocus, Enter submits, URL validation, spinner with "Building your room…"
- [*] Redirect to `/r/[id]` on success
- [*] `app/r/[id]/page.tsx` loads the room on the server; 404 page for unknown rooms
- [*] `ArticleView`: renders `content_html` with reader typography (serif, 18–19px, 1.7 line height, 68ch) *(`HtmlBody` in `components/room/doc-body.tsx`)*
- [*] Room header: back link, title, Share button (copies the URL, shows a toast) *(plus a QR code)*
- [*] `lib/identity.ts`: name and random person colour saved in localStorage *(`components/room/identity.ts`)*
- [*] `JoinDialog`: shown on first visit, name max 24 chars, colour preview *(`JoinGate`, a full-screen join page)*
- [ ] Error state: "We couldn't read this page" with **Paste text instead** (textarea → `/api/rooms/text`) and **Try another link** *(not built yet)*

**QA**
- [ ] Each of the 5 demo links creates a clean room
- [ ] A broken URL, a private IP and a JavaScript-only site all show the error state, not a crash
- [ ] Extracted pages contain no `<script>` tags
- [ ] Pasting `<div>hi</div> & <script>alert(1)</script>` shows that exact text in the room, with no HTML rendered

**Done when:** pasting a Wikipedia link opens a clean, readable room on the live URL.

---

## Phase 3: Realtime core (Sun 1 – 7 AM IST) · P0

**RT**
- [ ] `lib/useRoomChannel.ts`: one channel `room:{id}` with presence (key = my id), broadcast (`self: false`) and `postgres_changes` for `highlights` and `comments` filtered by `room_id` *(presence and broadcast built in `components/room/use-room-channel.ts`; highlights sync through the room ledger instead of `postgres_changes`)*
- [*] Track `{ name, color, following: null }` once subscribed
- [*] Clean up the channel on unmount
- [*] `lib/throttle.ts`: cursors every 50 ms, scroll every 200 ms *(inside `use-room-channel.ts`)*
- [*] `lib/anchors.ts`: `toAnchor()` converts a pointer position to `{ block, x, y }`; `fromAnchor()` converts back *(`components/room/anchors.ts`)*
- [*] Broadcast `cursor` events on pointer move over the content; send `cursor-leave` when the pointer leaves *(leaving sends a null anchor)*

**FE**
- [*] `PresenceBar`: avatars with initials and colour ring, max 5 then "+N", tooltip names *(top bar shows 4, then "+N")*
- [ ] "abhishek joined" / "abhishek left" toasts *(shown as lines in the Discussion tab, not toasts)*
- [*] `CursorLayer`: arrow plus name tag in the person's colour, framer-motion spring, fade after 5 s idle, own cursor hidden
- [*] `lib/highlights.ts`: `selectionToHighlight()` returns `{ block_id, start_offset, end_offset, quote }`, or null if the selection spans blocks *(`readSelection()` in `components/room/anchors.ts`)*
- [*] `HighlightToolbar`: floating above a selection with Highlight and Comment buttons *(also Copy, Underline and Ask AI)*
- [*] Render highlights by wrapping text slices in `<mark data-highlight-id>` with the person colour at 25% (light) / 35% (dark) *(drawn as an overlay over the text instead of `<mark>` tags, so the document HTML is never changed)*
- [ ] Load existing highlights and comments on page load, then apply live inserts *(saved highlights load; comments and live inserts from the table are not wired)*
- [ ] `CommentPanel` in a side panel: threads grouped by highlight, author colour dot, relative time, reply box *(not built; the room uses comment boxes pinned on the page instead)*
- [ ] Clicking a highlight opens its thread; clicking a thread scrolls to its highlight *(not built)*
- [ ] Empty state: "No highlights yet. Select any text to start." *(not built)*

**BE**
- [ ] Inserts for `highlights` and `comments` go straight from the browser with the anon key (allowed by RLS)
- [ ] Basic validation: quote max 1,000 chars, comment body max 2,000 chars (check constraint or trim on the client)

**QA**
- [ ] Two browsers see each other's presence, cursors, highlights and comments within about 1 second
- [ ] Cursors land on the same words on a phone and on a wide monitor
- [ ] Refreshing keeps all highlights and comments
- [ ] A cross-paragraph selection does nothing (no broken highlight)

**Done when:** two browsers see each other's cursors, highlights and comments live.

---

## Phase 4: PDF rooms (Sun 7 AM – 12 PM IST) · P0

**BE**
- [ ] Upload goes through the backend (multipart `file`, service role) to the `pdfs` bucket at `{roomId}.pdf`; the file is removed again if the room insert fails *(in repo)*
- [ ] Reject non-PDF files and files over 20 MB, on both client and server. Server side *(in repo)*: the bytes must start with `%PDF-` (Content-Type is ignored), over 20 MB is a 413, a damaged or password-protected PDF is a 422
- [ ] `POST /api/rooms/pdf`: creates a room with `kind = 'pdf'`, `pdf_path` and the file name (UTF-8) as title *(in repo)*
- [ ] Extract plain text of the first 50 pages (pdf.js via `unpdf`, max 60,000 chars, 10 s deadline) into `rooms.content_text` (`0006_pdf_text.sql`); the recap uses it for PDF rooms *(in repo)*

**FE**
- [ ] `PdfDropzone` on the landing page: drag and drop or click, shows file name and progress *(click to upload is built; drag and drop and progress are not)*
- [*] `PdfView` with react-pdf: text layer on, annotation layer off, each page wrapped in `data-block="p{n}"` *(`PdfBody` in `components/room/doc-body.tsx`)*
- [*] Pages render lazily (only near the viewport), width fits the reading column
- [*] Loading skeleton per page
- [*] Room page chooses `ArticleView` or `PdfView` by `kind`

**RT**
- [*] Reuse cursors, highlights and comments unchanged (block anchors `p1`, `p2`, …)

**QA**
- [ ] Both demo PDFs open; text is selectable; highlights land on the right words after refresh
- [ ] A 20 MB+ file and a non-PDF are rejected with a clear message

**Done when:** a PDF room has the same live features as a link room.

---

## Phase 5: Wow features (Sun 12 – 4 PM IST) · P1

**RT: Follow mode**
- [*] Broadcast `scroll` as `{ block, ratio }` for the block at the top of the viewport (200 ms throttle)
- [*] Click an avatar to follow; update presence `following`
- [*] Followers smooth-scroll to the leader's block
- [*] Following stops automatically when the follower scrolls by hand
- [ ] **Bring everyone here** button sends a `summon` event that every client obeys *(not built)*

**FE: Follow mode**
- [*] `FollowBanner`: "Following abhishek · Stop"
- [*] Avatar shows a small "following" indicator

**AI: Group recap**
- [ ] `POST /api/rooms/[id]/recap` loads title, text (cut to 60,000 chars), highlights and comments
- [ ] For PDF rooms, use the extracted PDF text
- [ ] Call Claude with the Anthropic SDK, model `claude-opus-5-5`, structured output validated by the zod `Recap` schema
- [ ] Handle refusal or empty output with a 502 and a friendly message
- [ ] Retry once on a network error (`callAi`: a refused or dropped connection only, never a timeout) *(in repo)*
- [ ] Save the result to `recaps`; return it
- [ ] Rate limit: one recap per room every 30 s (check the latest `recaps.created_at`; 429 with `Retry-After`), and one recap in progress per room (409) *(in repo)*
- [ ] If there are no highlights yet, return a gentle "Highlight a few things first" message instead of calling the API (422) *(in repo)*
- [ ] Save who asked as `recaps.requested_by` (body `{ name }`, else the signed-in user's name) for "Recapped by …" *(in repo)*
- [ ] Guardrails (`apps/ai/app/guardrails.py`): untrusted text in tags with a "data, not instructions" rule, injection attempts logged; output is plain text, links not in the source removed, quotes checked against highlights/document, names limited to people in the room, lists capped *(in repo)*

**AI: Three sources, one format** (migration `0010_ai_foundation.sql`)
- [ ] Room kinds `link`, `pdf`, `file`, `youtube`; `rooms.source_meta` `{ format, file_name }`; block ids `b{n}`, `p{n}`, `t{n}`; `room_ai` table (public read, backend writes, Realtime); private `files` bucket *(in repo)*
- [ ] `POST /api/rooms/file`: PDF, DOCX (mammoth, images dropped), PPTX (one `p{n}` block per slide), Markdown (marked + DOMPurify) and text, detected from the bytes; zip bomb guard (50 MB unpacked, 2,000 entries); strict UTF-8; `.doc`/`.ppt` get "Save as .docx/.pptx" *(in repo)*
- [ ] Link 422s carry site advice: Notion → Export, Google Docs/Slides → download .docx/.pptx, social sites → paste the text *(in repo)*

**AI: Chunks and embeddings** (migration `0011_chunks.sql`)
- [ ] `chunks` table (pgvector, 1024 dims, backend-only) and `match_chunks(p_room, p_embedding, p_query, p_k)`: vector, keyword or both merged by rank *(in repo)*
- [ ] AI service `POST /embed` (`passage` / `query`): one provider and model, no fallback, every vector checked against `EMBEDDING_DIM` *(in repo)*
- [ ] Backend `lib/chunk.ts` (~1,500–2,000 chars per chunk, ends on a block, with `block_ids`, page and headings) and `lib/ai-jobs.ts` `indexRoom` (embeds 64 at a time, keyword-only if embeddings fail), started after every room is created *(in repo)*

**AI: Detailed summary**
- [ ] AI service `POST /summary`: map-reduce over a room's chunks (groups of ~8k tokens, at most 3 at once, 12 groups max), with provider fallback per call; every point cites its blocks, and ids the room doesn't have are removed *(in repo)*
- [ ] Backend: after indexing, `summarizeRoom` saves `room_ai.summary` with status `ready` (Realtime tells the page); a summary that fails leaves the room ready to search, with the reason in `room_ai.error` *(in repo)*

**AI: Ask the room** (migration `0012_ai_messages.sql`)
- [ ] `ai_messages` table (public read like the room, backend-only write, Realtime) *(in repo)*
- [ ] `POST /api/rooms/:id/ask { question, name? }`: 10 questions a minute per IP and 30 per room; embeds the question (`query`), falls back to keyword search, `match_chunks` top 8, AI service `POST /answer` with `[C1]…[C8]` chunks; citations whose quote isn't in their chunk are dropped, none left means "not in this document"; pages and times come from the chunks *(in repo)*

**RT: Recap delivery**
- [ ] Subscribe to `postgres_changes` on `recaps` for the room so every screen gets it at once

**FE: Recap**
- [ ] **✨ Recap the room** button in the side panel; disabled with a countdown for 30 s after use *(not built in the room yet)*
- [ ] `RecapPanel`: loading skeleton, then sections for summary, key points, what the group cared about (with names), disagreements, open questions, next steps
- [ ] "Recapped by Arun · 2 min ago" line; toast "Recap ready" for everyone
- [ ] Quotes in the recap scroll to the matching highlight when clicked

**RT + FE: Emoji reactions**
- [ ] Reaction picker (🔥 👍 🤔 😂 ❤️) on paragraph hover or in the highlight toolbar
- [ ] Broadcast `react` with `{ block, emoji }`; never stored
- [ ] Emoji floats up and fades over about 1.5 s next to the paragraph

**FE: QR join**
- [*] QR button in the header opens a popover with the room QR code (`qrcode.react`) and the short link *(in the Share popover)*

**QA**
- [ ] Full demo flow works end to end with 3 browsers
- [ ] Recap appears on all screens within a few seconds; works for a link room and a PDF room

**Done when:** the full demo flow works end to end on the live URL.

---

## Study tools (quiz, flashcards, mind map, infographic)

**BE + AI** *(in repo)*
- [ ] `GET /api/study/sources`: documents (rooms) the user created or joined, optionally one project's (`group_id`)
- [ ] `POST /api/study`: `{ kind, all: true }` for Select all (20 most recently active) or `{ kind, room_ids }` for a hand-picked list (max 20, each checked); optional `count` (3–30) and `focus`
- [ ] apps/ai `POST /study`: shares the text budget fairly across documents, same provider fallback and untrusted-input rules as the recap; output is cleaned (valid answers, one-tree mind map, infographic stats must appear in the documents, `source_id` only real room ids)
- [ ] Sets saved in `study_sets` (`0017_study_sets.sql`, private); `GET /api/study`, `GET`/`DELETE /api/study/:id`
- [ ] One set per user at a time, 10 s cooldown

**FE**
- [ ] Study page: document picker with Select all and checkboxes, kind picker, then render quiz / flashcards / mind map / infographic (client calls are in `lib/api.ts` as `api.study.*`)

---

## Phase 6: Polish (Sun 4 – 8 PM IST) · P1

**FE: Landing page**
- [ ] Hero, link input, PDF drop zone, "How it works" (Paste → Share → Read together) *(hero, link input, PDF upload and How it works are built; the drop zone has no drag and drop yet)*
- [ ] **Live rooms right now**: 2–3 pre-made demo rooms with live presence counts
- [ ] Footer with GitHub link

**FE: Room polish**
- [*] Activity feed tab: "abhishek highlighted…", "Arun commented…", newest first *(the History tab)*
- [ ] Skeleton loaders for room, PDF pages and recap *(room and PDF pages done; recap not built)*
- [ ] Empty states for comments, activity and recap
- [ ] Dark mode checked on every screen
- [ ] Mobile layout: compact header, side panel becomes a bottom sheet, long-press to highlight *(bottom sheets done; long-press to highlight not built)*
- [ ] Keyboard focus rings, `aria-label`s on icon buttons
- [ ] Respect `prefers-reduced-motion`
- [ ] Favicon, page titles (`{doc title} · LinkRoom`) and Open Graph image for link previews *(favicon and page titles done; Open Graph image not built)*

**BE**
- [ ] Create the demo rooms in production and save their IDs in a config file
- [ ] Error logging in API routes (console is enough on Vercel)

**PM**
- [ ] P2 work only if everything above is stable (see Phase 8)
- [ ] **Feature freeze at 8 PM IST.** After that, only bug fixes.

**Done when:** a first-time user can go from landing page to a busy room and a recap without help, on desktop and phone.

---

## Dashboard (`/dashboard`) · P1, alongside Phase 6

A home for signed-in users: every room they created or joined, the people they read with, and a calendar of activity. **Rooms are live** (`GET /api/rooms/mine`, `PATCH /api/rooms/:id/status`, `POST /api/rooms/:id/join`, migration `0005`). **People, groups and profile stats are preview data** until their endpoints exist; their proposed contracts are in `packages/shared/src/dashboard.ts`. Signed out, or if the backend can't be reached, the whole page shows preview data and says so.

Room lifecycle (backend `RoomStatus`): **running** → **closed** (readable, no new highlights or comments) → **archived** (filed away) → **deleted** (soft delete, only the owner sees it and can restore it). **Paused** exists only in the dashboard's preview data so far; see BE below.

**FE** (`apps/frontend/src/components/dashboard/*`, route `app/dashboard/page.tsx`)
- [*] Layout: glass sidebar (sections + group tree, sheet on mobile), sticky glass top bar, Lenis smooth scroll, Cormorant / Cinzel typography *(in repo)*
- [*] Loads real rooms from `GET /api/rooms/mine` (active and deleted) and maps them with `fromApiRoom()`; falls back to preview data with a toast when the API fails *(in repo)*
- [*] Room list with status tabs and counts: All, Running, Paused, Closed, Archived, Deleted; one row of 3 cards, then **Show more** adds a row at a time *(in repo)*
- [*] Search rooms by title, source, group or participant; ⌘K / Ctrl+K focuses search *(in repo)*
- [*] Filters popover: type (link / PDF), group, last active (7 / 30 days), sort (activity, newest, most discussed, A–Z) *(in repo)*
- [*] Room menu, owner only: close / reopen, archive / unarchive, delete with Undo, restore, saved through `PATCH /api/rooms/:id/status` with optimistic updates and rollback on error *(in repo)*
- [*] Join room dialog: accepts a room code or any `/r/<code>` link; signed-in users go through `POST /api/rooms/:id/join`, which also catches wrong codes *(in repo)*
- [*] New room dialog (reuses the landing link / PDF form): optional room name, group dropdown (no group, an existing group, or create one inline) and a colour palette *(in repo; name, colour and group are kept in this browser until `rooms.title` / `color` / `group_id` can be set through the API)*
- [*] Room card: colour accent, status badge, source, group chip, up to 3 participant avatars + "+N", counts for highlights, comments, attachments and AI queries, last activity *(in repo; attachments, AI queries and participants are 0 / empty until the API returns them)*
- [*] Calendar: three rows per week (active, paused, archived; closed and deleted rooms stay off). A bar runs unbroken while any room has that status and lists up to 3 titles and "+N"; clicking it lists those rooms with each one's start and end dates. Active bars take one colour (the longest-running room's group colour, or its own colour if it has no group) and blink every 5 s; paused are red; archived dark grey *(in repo)*
- [*] Past participants ("Read with"), Following / Followers with Follow and "Add to room", invite dialog *(in repo, preview data)*
- [*] Paused rooms panel with one-tap Resume *(in repo, preview data only)*
- [*] Profile card: name, handle, email, bio, member since, rooms / highlights / followers / following *(in repo; name, email and rooms hosted are real)*
- [*] Edit profile (from the top bar or the profile card): change name, upload or remove a photo *(in repo; saved in this browser until `PATCH /api/me/profile` exists)*
- [*] Groups / projects: cards, create, delete (tick which rooms to delete too; the rest stay without a group), move a room into a group; the sidebar tree lists each group with its rooms nested under it (collapsible) *(in repo; saved in this browser until the groups API exists. Signed-in users start with no groups)*
- [*] Navbar "Dashboard" button while signed in; sign-in lands on `/dashboard` unless `?next=` says otherwise *(in repo)*
- [ ] Opening `/r/[id]` while signed in should call `POST /api/rooms/:id/join`, so visited rooms show up on the dashboard
- [ ] Swap the preview people, groups and profile stats for the endpoints below as they land

**BE: done** *(in repo)*
- [ ] Migration `0005_room_status_and_visits.sql`: `rooms.status` (running / closed / archived / deleted), `room_visits`, private `pdfs-deleted` bucket, RLS that hides deleted rooms and blocks writes to non-running rooms
- [ ] `GET /api/rooms/mine?q&status&kind&role&sort&limit&offset`, `POST /api/rooms/:id/join`, `PATCH /api/rooms/:id/status` (owner only, 409 on a race)

**BE: still needed for the dashboard** (all `requireAuth`, documented in `openapi.ts`)
- [ ] **Paused status**: add `paused` to `RoomStatus` and the `rooms.status` check (read-only like closed, but shown as "on hold"); then the dashboard's Pause / Resume actions can be saved
- [ ] `rooms.color` (hex, chosen in the New room dialog; accept it on `POST /api/rooms/link`, `/text`, `/pdf` and return it from `/mine`)
- [ ] `rooms`: `closed_at`, `paused_at`, `last_activity_at` (bumped on every highlight, comment, recap and AI query), so the calendar shows real spans instead of ending at the last visit
- [ ] `GET /api/rooms/mine` extras: `participants` preview (a few people per room), `live_count`, `attachment_count`, `ai_query_count`, `group_id`
- [ ] Groups: `room_groups` table + `rooms.group_id`; `GET / POST /api/groups`, `PATCH /api/groups/:id`, `DELETE /api/groups/:id?delete_rooms=id1,id2` (listed rooms are soft-deleted, the rest get `group_id = null`); set a room's group with `PATCH /api/rooms/:id` `{ group_id }`
- [ ] Room creation (`/api/rooms/link`, `/text`, `/pdf`) accepts optional `title`, `color` and `group_id`, so the New room dialog doesn't need browser storage
- [ ] Profiles: `profiles` table (`name`, `handle` unique, `avatar_url`, `bio`); `GET /api/me/profile` → `Profile` with stats; `PATCH /api/me/profile` `{ name? }`; `PUT / DELETE /api/me/avatar` (image upload to an `avatars` bucket, ≤ 2 MB, resized)
- [ ] People I've read with: `GET /api/me/participants` → `PastParticipant[]` (from `room_visits`, ranked by rooms together, then recency)
- [ ] Follows: `follows` table; `GET /api/me/following`, `GET /api/me/followers`, `POST / DELETE /api/users/:id/follow`, `GET /api/users/search?q=`
- [ ] Invites: `room_invites` table; `POST /api/rooms/:id/invites` `{ user_ids }`, `GET /api/me/invites` (for the notifications bell)
- [ ] Attachments (if they ship): `attachments` table + bucket; `GET / POST /api/rooms/:id/attachments`
- [ ] AI queries: `ai_queries` table, shared with Phase 8 "Ask AI"

**RT**
- [ ] `live_count` from a join heartbeat (`room_visits` seen in the last 2 minutes), so the dashboard doesn't subscribe to every room's presence
- [ ] Closing, archiving or deleting a room broadcasts a `status` event, so open rooms switch to read-only at once

**QA**
- [ ] A signed-in user sees exactly the rooms they created or joined; deleted rooms only on the Deleted tab
- [ ] Close → reopen, archive → unarchive, delete → Undo and delete → restore all survive a refresh; a member can't change a room's status
- [ ] Stopping the backend shows the "Couldn't load your rooms" toast and preview data, not a crash
- [ ] The calendar shows each room from start to end; archived rooms are grey
- [ ] Dashboard works on a phone (sheet menu, horizontally scrolling calendar) and in both themes

**Done when:** a signed-in user sees their real rooms, can close, archive, delete and restore them, and (once the people endpoints land) can invite someone they've read with in two taps.

---

## Link rooms workspace (`/r/[id]`) · P1, builds on Phases 3–5

A room now holds several sources and has three panes, like NotebookLM: Sources on the left, the document in the middle, and AI chat, Discussion, Studio, Library and History on the right. `/r/demo` runs without the backend.

How state is shared until the backend has tables for it: every change is an event in an append-only **ledger** (`components/room/ledger.ts`). Each browser keeps its copy in localStorage and peers exchange events over the `room:{id}` channel, merged by event id (`sync-req` / `sync` / `ledger` broadcasts). The room's state is the ledger replayed, and the History tab lists it. Text highlights are also written to `highlights`, so the recap still sees them.

**FE: the 17 room features** *(code in `apps/frontend/src/components/room/`)*

1. Upload files
   - [*] Upload PDF, PPTX, DOCX, TXT and MD from the device (drag and drop or browse, 20 MB each, several at once); `.ppt` / `.doc` are refused with "save it as .pptx / .docx first"
   - [*] Pick files from Google Drive (Docs and Slides are exported as DOCX / PPTX) *(needs `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_API_KEY`)*
2. Add links
   - [*] Link tab for Wikipedia, Notion, Medium, blogs, research papers, web docs and Substack, through `POST /api/rooms/link`; the backend's site advice is shown when a page can't be read
   - [ ] Firecrawl and OCR for pages Readability can't read and for scanned PDFs *(BE)*
3. YouTube
   - [*] Paste a YouTube link, watch a preview, then **Attach to watch** or **Process into document**
   - [*] Processing into a transcript document through `POST /api/rooms/youtube`
4. Anonymous entry
   - [*] Guests type a name (max 24) and pick a cursor colour to join a public room
   - [*] Owners and admins can remove someone (kick); the removed person sees "You were removed" and stays out after a reload
   - [*] The owner can close the room to guests (Settings → Access)
5. PDF and document annotation
   - [*] Highlight, draw and underline, in 7 colours
   - [*] Text comment boxes
   - [*] Select text → Ask AI
6. AI chat window
   - [*] Detailed chat about the room's documents, shared by everyone in the room
   - [*] Pick which document to ask about, or `@all` for every attachment; answers cite passages and clicking a citation jumps to it *(answered by `POST /api/rooms/:id/ask`, one call per document; falls back to a labelled Preview when the backend is down)*
7. Highlighting
   - [*] Text highlight when the text is selectable; drag over an area to highlight it when it isn't (scans, figures)
   - [*] Pen and eraser (you erase your own marks; admins can erase anyone's)
   - [*] Hovering a highlight or drawing shows who made it and when
8. Text comment boxes
   - [*] Click anywhere in a document to pin a comment; the author can edit or delete it
   - [*] Each comment shows who wrote it and when
9. Room settings for owner, admin, editor and viewer
   - [*] Settings dialog: members (here now or active before) with a role menu and Remove; defaults for guests and signed-in members; "viewers can use AI"; a table of what each role can do
   - [*] The UI follows the role: viewers can't annotate or add sources; admins can't change other admins
   - [ ] Enforce roles and kicks on the server *(backend has `room_members`; needs the ledger wiring below)*
10. AI query box
    - [*] Select text → Copy, Highlight, Underline, Comment, **Ask AI**
    - [*] Ask AI opens a box beside that line with the AI's answer, quick prompts and follow-up questions in a scrolling thread; it shows who opened it
11. AI lens
    - [*] **AI lens** button in the tool dock (key L): drag a marquee over any part of the page; the snapshot (cropped from the PDF canvas, or drawn with html-to-image) opens an AI box next to it, showing who made it
    - [ ] Answers for lens snapshots *(backend ready: `/ask` takes `image`; needs the `/ask` wiring below)*
12. Cursors and follow
    - [*] Live cursors with name tags in each person's colour, on whichever document they're reading
    - [*] Follow anyone from their avatar: you switch to their document and scroll with them, a banner says "Following …", and scrolling yourself stops it
13. Discussion panel
    - [*] Group chat for everyone in the room
    - [*] "joined" and "left" lines when people come and go
14. Studio
    - [*] Create a summary, quiz, flashcards, mind map or infographic, choosing which sources to include or leave out
    - [*] Generated with AI through `POST /api/rooms/:id/artifacts` (a labelled Preview only when the server can't be reached)
15. Library
    - [*] Separate tabs for Attachments and Artifacts, still available when the room is archived
    - [*] Downloads: PDFs as PDF, other sources as readable HTML, artifacts as Markdown, JSON or PNG
    - [ ] Download the original DOCX / PPTX *(backend ready: `GET /api/rooms/:id/original`; needs the Library button below)*
16. Version history
    - [*] An uneditable log (like Google Docs) of who attached sources, annotated, made artifacts, asked the AI or changed roles, with the time; filters by type; click an entry to jump to that spot
17. Inspiration from Google Docs and NotebookLM
    - [*] NotebookLM-style layout: Sources on the left, the document in the middle, AI chat / Discussion / Studio / Library / History on the right
    - [*] Google Docs-style tool dock, version history and presence avatars
    - [*] Regal, glassy design: liquid-glass panels, Cormorant / Cinzel type, Lenis smooth scrolling in the document, gradient-bars background on the join screen
    - [*] Phone layout: a bottom bar opens Sources or the room panel as a sheet you can drag down to close

**BE** (the frontend already calls `/ask` and `/artifacts`, and falls back to a labelled **Preview** when they return 404)
- [x] `POST /api/rooms/:id/ask` `{ question, name?, sources?: room_id[], quote?, history?, image? (JPEG/PNG/WebP data URL) }` → `AiMessage`; `match_chunks` over each chosen room, interleaved by rank; citations carry `room_id` when several rooms were asked. The image goes only to `VISION_MODELS` (apps/ai answers 501 without one → backend 422). Saved to `ai_messages` and `ai_queries`. Follows the room's roles (`useAi`, kicks).
- [x] `POST /api/rooms/:id/artifacts` `{ kind: summary|quiz|flashcards|mindmap|infographic, sources }` → `ArtifactBody`. Summary from `room_ai.summary` (no AI call); the rest through apps/ai `/study`. Editors and up, one per room at a time, rate-limited like Ask, recorded in `ai_queries` (kind `artifact`).
- [x] `POST /api/rooms/youtube` `{ url }` → `{ id }`: a `youtube` room with transcript segments as `t{n}` blocks
- [x] `room_attachments` table (room_id, source_room_id, added_by, position; `room_sources` already holds transcripts) plus `GET/POST/DELETE /api/rooms/:id/sources`, so attachments don't depend on peers being online
- [x] The ledger in the database as an event store: append-only `room_events` (every `LedgerEvent`, the History), with `room_members` (role, kicked_at, guest key hash) and `room_settings` kept from it. `GET/POST /api/rooms/:id/events`, `GET /api/rooms/:id/members`; roles and kicks enforced in the API (`lib/ledger.ts`). Guests send `X-Guest-Id` + `X-Guest-Key`.
- [x] A signed download link for an uploaded room's original file (private `files` bucket, or `pdfs`): `GET /api/rooms/:id/original`
- [x] Notes as comments: `comments.highlight_id` may be null in `NewComment`, so comment boxes reach the recap

**FE: wire to the new backend**
- [ ] Ledger: load with `GET /events` (paged by `seq`) on join, append with `POST /events` alongside the realtime broadcast; send `X-Guest-Id`/`X-Guest-Key` for guests (keep the key in the browser next to the guest id); show `rejected` reasons; replace `localStorage` as the source of truth
- [ ] Sources rail: `GET/POST/DELETE /sources` instead of `doc.add`/`doc.remove` alone
- [ ] AI boxes and chat: one `/ask` call with `sources`, `quote`, `history`, `image` instead of one call per document; map citations by `room_id`
- [ ] Library: a "Download original" button from `GET /original`

**QA**
- [ ] Two browsers on `/r/demo`: presence, cursors, highlights, drawings, comments, AI boxes, chat and artifacts appear on both; the later joiner receives everything
- [ ] Follow someone across two sources; scrolling yourself stops following
- [ ] Viewer can't annotate; removed guest sees "You were removed" and stays out after a reload
- [ ] Archived room: read only, Library still downloads

**Done when:** a group can attach mixed sources, mark them up together, ask the AI about any part, and leave with artifacts and a full history.

---

## Room extras · P1 / P2, after the workspace

Seven features that make a room work for groups beyond reading side by side. `[*]` means built (frontend or backend) but not yet checked on the deployed URL.

1. Voice huddle with live captions
   - [ ] Pick the transport: LiveKit (hosted SFU, simplest at more than 3 people) or plain WebRTC through the room's realtime channel for signalling (fine for 2–4)
   - [ ] **BE:** `POST /api/rooms/:id/huddle/token` → a LiveKit access token for this room (identity = member or guest id, name, colour); only members who aren't kicked
   - [ ] **FE:** a huddle bar in the room: join with everyone, or pick who to talk to (a private huddle with chosen people); mute, leave, speaking rings on avatars; works for guests
   - [ ] **FE / AI:** live captions under the speaker's avatar (LiveKit transcription agent, or the browser's speech recognition as a fallback), with a captions on / off switch
2. Huddle notes (builds on the huddle)
   - [ ] **BE:** keep the live transcript per room (`huddle_transcripts`: speaker, text, start time), written as captions finish
   - [ ] **FE:** with each transcript line, record the block each speaker had on screen at that moment (from the scroll updates already sent), so a line knows what text people were looking at
   - [ ] **AI:** turn a finished huddle into meeting notes (decisions, action items, open questions); every point links to the passage being discussed when it was said
   - [ ] **FE:** notes appear in the Library and can be dropped into the shared notebook; clicking a point opens the source at that passage
3. Laser focus: "everyone look here"
   - [*] **Everyone look here** in the top bar (editors and up, in a live room): everyone else is taken to your document and scroll position, follow mode locked, until you press **Stop focus**
   - [*] Your pointer becomes a laser that stays on screen for the others, labelled "Name · look here"
   - [*] When the focus ends (or someone leaves it), each person goes back to the document and spot they were reading before
   - [*] One focus at a time: others see "Name is focusing", and anyone can step out of it; a new focus by the same person can be joined again
   - Built on presence (`focusing`) and the follow feature; nothing is stored, so there is no backend part
4. Room notebook
   - [*] **Notebook** button in the top bar (with a count) opens a drawer; the side panel keeps five tabs
   - [*] Notes people leave for the room: typed notes, passages saved from a source (Selection toolbar → **Save to notebook**, linking back to that line) and images (attach, paste or drop; shrunk before they're shared), each with who added it and when
   - [*] Filter by Notes / Passages / Images; anyone who can annotate edits an entry ("edited by" shows on it), the author or an admin deletes it; every change is in History
   - [*] Download the notebook as Markdown
   - [ ] **BE:** keep notebook entries in the stored ledger (`notebook.add` / `notebook.edit` / `notebook.remove` in `LedgerEvent`), so the notebook is there for people who join while nobody else is in the room
5. "While you were away" catch-up
   - [*] **BE + AI:** `POST /api/rooms/:id/catchup { since }` summarises the highlights and comments made since then (apps/ai `/catchup`; nothing is saved, and the AI isn't called when there's nothing new)
   - [ ] **FE:** remember when you last left each room; when you come back, show a short "While you were away" card with what changed (new highlights, comments being discussed, new sources and artifacts from the ledger)
   - [ ] **FE:** "waiting on you": questions and comments that @mention you (needs feature 6)
6. Mentions and notifications
   - [*] **FE:** `@name` in Discussion messages and comment boxes, with a picker (↑ ↓, Enter / Tab) of people who have joined the room or whom you follow; mentions show as chips, and messages that mention you are highlighted
   - [*] **BE:** `notifications` and `push_subscriptions` (migration `0025_notifications.sql`); `GET /api/notifications/rooms/:id/people`, `POST /api/notifications/rooms/:id/mentions`, `GET /api/notifications`, `POST /api/notifications/read`
   - [*] **BE:** an email for a mention when the person is away (the SMTP mailer), and a realtime `notify` broadcast when they're in the room
   - [*] **FE:** in-room toast when you're mentioned; the dashboard lists your mentions (unread count, mark read, click to open the room), refreshed every 30 s and when you come back to the tab
   - [*] **FE + BE:** browser push notifications (service worker `public/sw.js`, Web Push with VAPID keys, `/api/notifications/key`, `/subscribe`, `/unsubscribe`), turned on from the dashboard
   - [ ] **BE:** mentioning someone you follow who has never opened the room notifies them too (the backend only notifies people who have joined it)
7. Who's-where minimap
   - [*] **FE:** Active Readers in the Sources rail: who is on which document; clicking someone (or **Go to where they're reading** on their avatar) opens that document at their exact spot, asking their browser for it when no scroll update has arrived yet
   - [ ] **FE:** a slim bar beside the document with each reader's avatar at their spot, click an avatar to jump there
   - [ ] **FE:** "race to finish": how far each person has read (furthest block reached / blocks in the document), as a small progress view
**Done when:** a group can talk while they read with captions on, leave with notes tied to the text, pull everyone to one spot, keep a shared notebook of what mattered, and catch up on what they missed.

---

## Phase 7: Test and ship (Sun 8 PM – Mon 1:30 AM IST)

**QA: Bug bash**
- [ ] Test on 3 devices, including one phone (Chrome desktop, Safari or Chrome on a phone, a second laptop)
- [ ] 4+ people in one room at once: cursors stay smooth, nothing duplicates
- [ ] Refresh, rejoin and network drop: presence recovers, data is kept
- [ ] Every demo link and PDF works on the production URL
- [ ] Error paths: bad URL, blocked site, big PDF, recap with no highlights
- [ ] No secrets in the client bundle (search the built JS for `service_role` and `sk-ant`)

**PM: Demo video (about 2:30)**
- [ ] 0:00 Problem: "We share links, then discuss them through screenshots. The internet is single-player."
- [ ] 0:20 Paste a Wikipedia link, copy the room link, three windows join
- [ ] 0:50 Cursors, a highlight, a comment, reactions, follow mode
- [ ] 1:30 Drop an arXiv PDF; same live features
- [ ] 1:55 Click Recap; it lands on every screen at once
- [ ] 2:20 "Any link. Any PDF. Instantly multiplayer." with the live URL and QR code
- [ ] Upload the video (YouTube or Vimeo, public or unlisted)

**PM: README**
- [ ] GIF of the room in action at the top
- [ ] Pitch line, features list, architecture diagram
- [ ] Setup steps (env vars, schema, `npm run dev`)
- [ ] Tested links gallery and known limits (no JS-only sites, single-block highlights, 60k-char recap limit, open RLS for the demo)

**PM: Devpost submission**
- [ ] Story: Inspiration, What it does, How we built it, Challenges, Accomplishments, What we learned, What's next
- [ ] Screenshots: landing page, busy room, recap
- [ ] Built-with tags: Next.js, Supabase, Claude, Vercel, Tailwind
- [ ] Live URL, repo URL and video URL added
- [ ] Every teammate added to the Devpost project
- [ ] Opt into sponsor job outreach if offered
- [ ] **Submitted by Mon 1:30 AM IST**, one hour before the deadline

**Done when:** the submission is in and the live URL works.

---

## Phase 8: Stretch (P2, only if Phases 1–7 are stable)

Pick from the top; each item must be finished and deployed before the next starts.

**FE + RT: Attention heatmap** (best value)
- [ ] Count highlights per block and time spent per block (from scroll events)
- [ ] Margin bar to the left of the content, darker where the group focused

**AI + BE + FE: Ask AI about a paragraph**
- [ ] Ask AI button in the highlight toolbar
- [ ] `POST /api/rooms/[id]/ask` with the paragraph and question; store the answer as a special comment
- [ ] The answer appears in the thread for everyone

**BE + FE: Agree / disagree votes**
- [ ] `votes` table (or a count column) and 👍 / 👎 on highlights and comments

**FE: Export notes**
- [ ] Download highlights, comments and recap as Markdown

**FE + RT: Synced YouTube**
- [ ] YouTube link creates a video room; play, pause and seek are broadcast; timestamp comments

**FE: One-line script SDK**
- [ ] A `<script>` tag that adds cursors and comments to any page (demo page only)

**FE + BE: Session replay**
- [ ] Replay highlights and comments in time order with a slider

---

## Risk checklist (keep an eye on it during the build)

- [ ] Demo only with pre-tested links; keep the recorded video as backup
- [ ] Switch `jsdom` to `linkedom` if the Vercel function is too large
- [ ] Highlights stay inside one block; verify against the stored `quote`
- [ ] Cursors and scroll are throttled and never stored
- [ ] PDFs over 20 MB are rejected; pages render lazily
- [ ] DOMPurify on every extraction; private hosts blocked
- [ ] Recap has a loading state, one retry, a friendly error, and a 30 s cooldown
- [ ] Anthropic spending limit is set
- [ ] Every phase ends deployed, so we can submit from any phase if time runs out
