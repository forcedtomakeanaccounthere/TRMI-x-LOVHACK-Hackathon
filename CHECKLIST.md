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
- [ ] Run `supabase/migrations/0001_init.sql` then `0002_auth_and_phase1.sql` in the SQL editor *(in repo)*
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
- [ ] Supabase dashboard: Confirm email ON; redirect URLs include `<backend>/api/auth/verify`; "Confirm signup" template link = `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`; custom SMTP (e.g. Resend)

**FE**
- [ ] Fonts with `next/font`: Inter, Source Serif 4, JetBrains Mono
- [ ] Colour tokens in `globals.css` for light and dark, plus the 8 person colours
- [ ] Theme provider with system default and a toggle
- [ ] Empty landing page with the hero text

**QA**
- [ ] Live Vercel URL loads in light and dark mode
- [ ] Unit, integration and e2e tests pass (`npm test`, `npm run test:e2e`) *(in repo)*
- [ ] CI workflow runs on every PR; **CI passed** set as a required check on `main` (GitHub → Settings → Branches)

**Done when:** the live Vercel URL loads, Supabase tables exist, and a new account can sign up, verify by email and log in.

---

## Phase 2: Link rooms (Sat 9 PM – Sun 1 AM IST) · P0

**BE**
- [ ] `lib/extract.ts`: `isPrivateHost()` blocks `localhost`, `127.*`, `10.*`, `172.16–31.*`, `192.168.*`, `169.254.*`, `::1`
- [ ] `POST /api/rooms/link`: accept only `http`/`https`, reject private hosts
- [ ] Fetch with a browser-like User-Agent and a 10 s timeout
- [ ] Run Readability on the HTML; return 422 with a friendly message if no content
- [ ] Sanitize with DOMPurify
- [ ] `addBlockIds()`: add `data-block="b0"…` to `p, h1–h6, li, blockquote, pre, figure`
- [ ] Make relative image and link URLs absolute; open links in a new tab with `rel="noopener"`
- [ ] Insert the room with `nanoid(8)` and return `{ id }`
- [ ] `POST /api/rooms/text`: create a room from pasted text (split by blank lines into `<p data-block>`)
- [ ] HTML-escape pasted text (`&`, `<`, `>`, `"`, `'`) before wrapping it in `<p>`, so it always shows as plain text
- [ ] Check the function size on Vercel; switch `jsdom` to `linkedom` if it is too big

**FE**
- [ ] `LinkInput` on the landing page: autofocus, Enter submits, URL validation, spinner with "Building your room…"
- [ ] Redirect to `/r/[id]` on success
- [ ] `app/r/[id]/page.tsx` loads the room on the server; 404 page for unknown rooms
- [ ] `ArticleView`: renders `content_html` with reader typography (serif, 18–19px, 1.7 line height, 68ch)
- [ ] Room header: back link, title, Share button (copies the URL, shows a toast)
- [ ] `lib/identity.ts`: name and random person colour saved in localStorage
- [ ] `JoinDialog`: shown on first visit, name max 24 chars, colour preview
- [ ] Error state: "We couldn't read this page" with **Paste text instead** (textarea → `/api/rooms/text`) and **Try another link**

**QA**
- [ ] Each of the 5 demo links creates a clean room
- [ ] A broken URL, a private IP and a JavaScript-only site all show the error state, not a crash
- [ ] Extracted pages contain no `<script>` tags
- [ ] Pasting `<div>hi</div> & <script>alert(1)</script>` shows that exact text in the room, with no HTML rendered

**Done when:** pasting a Wikipedia link opens a clean, readable room on the live URL.

---

## Phase 3: Realtime core (Sun 1 – 7 AM IST) · P0

**RT**
- [ ] `lib/useRoomChannel.ts`: one channel `room:{id}` with presence (key = my id), broadcast (`self: false`) and `postgres_changes` for `highlights` and `comments` filtered by `room_id`
- [ ] Track `{ name, color, following: null }` once subscribed
- [ ] Clean up the channel on unmount
- [ ] `lib/throttle.ts`: cursors every 50 ms, scroll every 200 ms
- [ ] `lib/anchors.ts`: `toAnchor()` converts a pointer position to `{ block, x, y }`; `fromAnchor()` converts back
- [ ] Broadcast `cursor` events on pointer move over the content; send `cursor-leave` when the pointer leaves

**FE**
- [ ] `PresenceBar`: avatars with initials and colour ring, max 5 then "+N", tooltip names
- [ ] "Priya joined" / "Priya left" toasts
- [ ] `CursorLayer`: arrow plus name tag in the person's colour, framer-motion spring, fade after 5 s idle, own cursor hidden
- [ ] `lib/highlights.ts`: `selectionToHighlight()` returns `{ block_id, start_offset, end_offset, quote }`, or null if the selection spans blocks
- [ ] `HighlightToolbar`: floating above a selection with Highlight and Comment buttons
- [ ] Render highlights by wrapping text slices in `<mark data-highlight-id>` with the person colour at 25% (light) / 35% (dark)
- [ ] Load existing highlights and comments on page load, then apply live inserts
- [ ] `CommentPanel` in a side panel: threads grouped by highlight, author colour dot, relative time, reply box
- [ ] Clicking a highlight opens its thread; clicking a thread scrolls to its highlight
- [ ] Empty state: "No highlights yet. Select any text to start."

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
- [ ] Upload from the browser to the `pdfs` bucket at `{roomId}.pdf` (or through a signed upload URL)
- [ ] Reject non-PDF files and files over 20 MB, on both client and server
- [ ] `POST /api/rooms/pdf`: creates a room with `kind = 'pdf'`, `pdf_path` and the file name as title
- [ ] Extract plain text of the first pages (pdf.js) for the AI recap, or extract it later in the recap route

**FE**
- [ ] `PdfDropzone` on the landing page: drag and drop or click, shows file name and progress
- [ ] `PdfView` with react-pdf: text layer on, annotation layer off, each page wrapped in `data-block="p{n}"`
- [ ] Pages render lazily (only near the viewport), width fits the reading column
- [ ] Loading skeleton per page
- [ ] Room page chooses `ArticleView` or `PdfView` by `kind`

**RT**
- [ ] Reuse cursors, highlights and comments unchanged (block anchors `p1`, `p2`, …)

**QA**
- [ ] Both demo PDFs open; text is selectable; highlights land on the right words after refresh
- [ ] A 20 MB+ file and a non-PDF are rejected with a clear message

**Done when:** a PDF room has the same live features as a link room.

---

## Phase 5: Wow features (Sun 12 – 4 PM IST) · P1

**RT: Follow mode**
- [ ] Broadcast `scroll` as `{ block, ratio }` for the block at the top of the viewport (200 ms throttle)
- [ ] Click an avatar to follow; update presence `following`
- [ ] Followers smooth-scroll to the leader's block
- [ ] Following stops automatically when the follower scrolls by hand
- [ ] **Bring everyone here** button sends a `summon` event that every client obeys

**FE: Follow mode**
- [ ] `FollowBanner`: "Following Priya · Stop"
- [ ] Avatar shows a small "following" indicator

**AI: Group recap**
- [ ] `POST /api/rooms/[id]/recap` loads title, text (cut to 60,000 chars), highlights and comments
- [ ] For PDF rooms, use the extracted PDF text
- [ ] Call Claude with the Anthropic SDK, model `claude-opus-5-5`, structured output validated by the zod `Recap` schema
- [ ] Handle refusal or empty output with a 502 and a friendly message
- [ ] Retry once on a network error
- [ ] Save the result to `recaps`; return it
- [ ] Rate limit: one recap per room every 30 s (check the latest `recaps.created_at`)
- [ ] If there are no highlights yet, return a gentle "Highlight a few things first" message instead of calling the API

**RT: Recap delivery**
- [ ] Subscribe to `postgres_changes` on `recaps` for the room so every screen gets it at once

**FE: Recap**
- [ ] **✨ Recap the room** button in the side panel; disabled with a countdown for 30 s after use
- [ ] `RecapPanel`: loading skeleton, then sections for summary, key points, what the group cared about (with names), disagreements, open questions, next steps
- [ ] "Recapped by Arun · 2 min ago" line; toast "Recap ready" for everyone
- [ ] Quotes in the recap scroll to the matching highlight when clicked

**RT + FE: Emoji reactions**
- [ ] Reaction picker (🔥 👍 🤔 😂 ❤️) on paragraph hover or in the highlight toolbar
- [ ] Broadcast `react` with `{ block, emoji }`; never stored
- [ ] Emoji floats up and fades over about 1.5 s next to the paragraph

**FE: QR join**
- [ ] QR button in the header opens a popover with the room QR code (`qrcode.react`) and the short link

**QA**
- [ ] Full demo flow works end to end with 3 browsers
- [ ] Recap appears on all screens within a few seconds; works for a link room and a PDF room

**Done when:** the full demo flow works end to end on the live URL.

---

## Phase 6: Polish (Sun 4 – 8 PM IST) · P1

**FE: Landing page**
- [ ] Hero, link input, PDF drop zone, "How it works" (Paste → Share → Read together)
- [ ] **Live rooms right now**: 2–3 pre-made demo rooms with live presence counts
- [ ] Footer with GitHub link

**FE: Room polish**
- [ ] Activity feed tab: "Priya highlighted…", "Arun commented…", newest first
- [ ] Skeleton loaders for room, PDF pages and recap
- [ ] Empty states for comments, activity and recap
- [ ] Dark mode checked on every screen
- [ ] Mobile layout: compact header, side panel becomes a bottom sheet, long-press to highlight
- [ ] Keyboard focus rings, `aria-label`s on icon buttons
- [ ] Respect `prefers-reduced-motion`
- [ ] Favicon, page titles (`{doc title} · LinkRoom`) and Open Graph image for link previews

**BE**
- [ ] Create the demo rooms in production and save their IDs in a config file
- [ ] Error logging in API routes (console is enough on Vercel)

**PM**
- [ ] P2 work only if everything above is stable (see Phase 8)
- [ ] **Feature freeze at 8 PM IST.** After that, only bug fixes.

**Done when:** a first-time user can go from landing page to a busy room and a recap without help, on desktop and phone.

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
