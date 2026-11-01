# Plan: Voice huddles with live captions + AI huddle notes (backend only)

## Context
LinkRoom rooms are text-only today. We're adding (1) **voice huddles** — a room-wide call or a private call with chosen members, with live captions — and (2) **huddle notes** — the AI turns the transcript into meeting notes where every point links to the passage (`{doc, block}`) people were looking at when it was said. Backend only (apps/backend, apps/ai, supabase, packages/shared). Everything must run on free tiers (Render, Vercel, LiveKit Cloud, Supabase); Render cold starts are already handled by the team's cron.

Decisions made:
- **LiveKit Cloud** carries audio. The backend only mints tokens and calls LiveKit's RoomService API.
- **Captions come from the browser** (Web Speech API; Chrome/Edge). Interim text goes over the LiveKit data channel (no backend); final sentences are POSTed to the backend. No always-on caption bot (impossible on Render free).
- **Viewers listen only**; editors and above speak.
- **Notes are generated when the huddle ends + on demand** via a refresh endpoint.
- No LiveKit webhook (unreliable on a sleeping free host); huddles close via the End endpoint or a lazy "is anyone still there?" check.

## 0. Fix the duplicate migration number (prerequisite)
`supabase/migrations/` has two `0026_*` files. Rename `0026_room_events_types.sql` → `0027_room_events_types.sql` (check `supabase migration list` against the hosted project first; if 0026_room_events_types is already applied there, rename the other one instead). The new migration is `0028_huddles.sql`.

## 1. Database — `supabase/migrations/0028_huddles.sql`
Same conventions as `0020_room_ledger.sql`: RLS on, no policies, `revoke all … from anon, authenticated` — only apps/backend (service role) touches these. Private-huddle content never goes into `room_events`.

- `huddles` — `id text pk` (`h_` + nanoid), `room_id → rooms on delete cascade`, `livekit_room text unique` (`lr_{roomId}_{id}`), `audience text check in ('all','private')`, `created_by`, `created_by_name`, `started_at`, `ended_at`, `notes_status text check in ('none','generating','ready','failed') default 'none'`, `notes_error text`.
  Partial unique index: one open `all` huddle per room — `(room_id) where audience = 'all' and ended_at is null`.
- `huddle_members` — `(huddle_id, member_id) pk`, `name`, `invited_by` (null for `all`), `invited_at`, `joined_at`, `left_at`. Private: rows are the invite list. `all`: row added on first join.
- `huddle_segments` (append-only trigger like `room_events_append_only`) — `(huddle_id, id) pk` (id made by the browser → retries are safe), `seq bigint identity`, `speaker_id`, `speaker_name`, `text (≤1000)`, `start_at`, `end_at`, `doc text null`, `block text null` (the speaker's focus).
- `huddle_focus` — `huddle_id, member_id, doc, block, at timestamptz default now()`; index `(huddle_id, at)`. What each person was looking at over time (server clock), so notes can use the room's majority focus, not just the speaker's.
- `huddle_notes` — `(huddle_id, version) pk`, `notes jsonb`, `created_at`.

## 2. Shared types — `packages/shared/src/huddle.ts` (export from `index.ts`)
Zod schemas reusing `Id`/`Text` style from `ledger.ts`:
`HuddleAudience`, `CreateHuddleRequest` (`{audience:"all"} | {audience:"private", members: Id[] (1–20)}`), `HuddleSummary`, `ListHuddlesResponse`, `HuddleJoinResponse` (`{huddle, livekit: {url, token}}`), `InviteHuddleRequest`, `HuddleSegmentIn` (`id, text, start_at, end_at, focus: {doc, block} | null`), `PostSegmentsRequest` (≤20), `HuddleFocusRequest`, `HuddleTranscriptQuery/Response` (named to avoid the existing `TranscriptResponse`), `HuddleNotePoint` (`text, owner?, segment_ids, anchor: {doc, block} | null, at`), `HuddleNotes` (`summary, decisions[], action_items[], open_questions[], key_points[]`), `HuddleNotesResponse` (`status, version, notes | null`).

## 3. Backend

### Env (`apps/backend/src/env.ts`, `.env.example`)
`LIVEKIT_URL` (wss://…), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — optional; without them huddle routes answer **503 "Voice huddles aren't set up"** so dev and tests boot unchanged. `HUDDLE_RATE_LIMIT` (joins/creates per IP per minute, default 20), `HUDDLE_SEGMENT_RATE_LIMIT` (default 120). Dependency: `livekit-server-sdk` in `apps/backend/package.json`.

### `src/lib/livekit.ts` — thin wrapper (the only file that imports the SDK)
- `grantsFor(role, livekitRoom)` — **pure**: `roomJoin`, `room` = that huddle only, `canSubscribe: true`, `canPublish: can.annotate(role)`, `canPublishSources: [MICROPHONE]`, `canPublishData: can.annotate(role)` (interim captions; LiveKit stamps the sender's identity so it can't be spoofed), `canUpdateOwnMetadata: false`.
- `mintToken(identity, name, role, livekitRoom)` — `AccessToken`, identity = member id from `roomAccess()` (never from the body), `ttl: "10m"`, metadata `{role, signedIn}`.
- `removeFromRoom`, `setPublish`, `participantCount`, `closeRoom` via `RoomServiceClient` (URL = LIVEKIT_URL with wss→https). Errors are logged, never thrown into the caller's request (except `participantCount`, which returns `null` on failure = "unknown, don't close").

### `src/lib/huddles.ts` — access rules + side effects
- `huddleAccess(roomId, huddleId, req)` → `{access, huddle, member}` using `roomAccess()` + `assertParticipant()` from `lib/ledger.ts`; 404 for an unknown huddle **or a private huddle the caller isn't invited to** (owner included — private means private).
- Rules (pure, unit-tested):
  - join `all` / start `all`: any participant (viewers too, listen-only via grants).
  - start private / invite: `can.annotate(role)`; invitees must be in `room_members`, not kicked (or the room owner).
  - end: creator or `can.manage(role)`.
  - post segments: huddle member with `can.annotate(role)`, huddle open (or ended < 60 s ago, for trailing sentences).
  - refresh/read notes & transcript: huddle member (private) or `assertReader` (`all`); refresh also needs `can.useAi(role, settings)`.
- `onMembershipEvents(roomId, events)` — called after the ledger accepts events: `member.kick` → `removeFromRoom` in every open huddle of that room; `role.set` → `setPublish(can.annotate(newRole))`. Fire-and-forget.
- `pingHuddles(roomId)` — Realtime broadcast `huddles.changed` (no payload contents) on `roomChannel(roomId)`, modelled on `broadcastRoomStatus` in `routes/rooms.ts`. Clients refetch `GET /huddles`, which filters by access, so private huddles don't leak via the room channel.
- `closeIfEmpty(huddle)` — lazy close: open huddle, started > 2 min ago, `participantCount === 0` → end it + start notes.

### `src/lib/huddle-notes.ts` — background job (pattern of `startIndexing` in `lib/ai-jobs.ts`)
- `startNotes(huddleId)` never throws; one run per huddle in-process (`running` set); `notes_status` → `generating` → `ready`/`failed`; `pingHuddles` on each change.
- Loads segments (cap ~800 / ~60k chars, most recent kept) and `huddle_focus`.
- **Anchor per segment (pure `focusAt`)**: majority `{doc,block}` among all huddle members' latest focus at the segment's `end_at`; tie or none → the speaker's own `doc/block`.
- Block excerpts: `chunks` rows whose `block_ids` contain the anchored blocks, limited to docs in `roomScope(roomId, null)` (`lib/sources.ts`).
- `callAi("/huddle-notes", body, HuddleNotesData, 120_000)` (`lib/ai.ts`).
- **Validation (pure `resolveNotes`)**: drop unknown segment ids; drop points with none left; each point's `anchor` = most common anchor of its cited segments (the AI never invents block ids); `at` = first cited segment's `start_at`. Save as `huddle_notes` version n+1.

### `src/routes/huddles.ts` — `huddlesRoutes(roomsRouter)`, registered in `routes/rooms.ts` next to `ledgerRoutes`/`notebookRoutes`
All use `optionalAuth`; guests authenticate with `X-Guest-Id`/`X-Guest-Key` exactly like the ledger (`identify()`); a guest's first huddle action claims its id the same way `claimGuest` does in `routes/ledger.ts` (extract that helper to `lib/ledger.ts` and reuse).

| Route | Does |
|---|---|
| `GET /:id/huddles` | Open + last 10 ended huddles visible to the caller, with `notes_status`; runs `closeIfEmpty` on stale open ones |
| `POST /:id/huddles` | Create (`all`: returns the existing open one if any) → `HuddleJoinResponse`; 201 |
| `POST /:id/huddles/:hid/join` | Records `joined_at`, mints token |
| `POST /:id/huddles/:hid/leave` | Sets `left_at`; if nobody is left in LiveKit, close + notes |
| `POST /:id/huddles/:hid/invite` | Adds members to a private huddle |
| `DELETE /:id/huddles/:hid/members/:memberId` | Un-invite → `removeFromRoom` |
| `POST /:id/huddles/:hid/end` | `ended_at`, `closeRoom`, `startNotes` |
| `POST /:id/huddles/:hid/segments` | Batch of final captions; speaker = caller; times clamped to `[started_at, now+5s]`; focus kept only if doc ∈ `roomScope` and block matches `^[a-z]\d{1,6}$`; `ignoreDuplicates` on retry; also appends the speaker's focus to `huddle_focus` |
| `POST /:id/huddles/:hid/focus` | `{doc, block}` when the caller's visible block changes (client throttles to ≥2 s); rate-limited |
| `GET /:id/huddles/:hid/transcript?after=` | Segments by `seq`, paged like `GET /:id/events` |
| `POST /:id/huddles/:hid/notes` | On-demand refresh → 202, `startNotes`; uses the existing `askPerIp/askPerRoom` limiters |
| `GET /:id/huddles/:hid/notes` | Latest notes + status |

Hook in `routes/ledger.ts`: after `checkAndAppend` succeeds, call `onMembershipEvents(id, acceptedEvents)` (void).

### `src/openapi.ts`
Add every route above (tag "Voice huddles") — `test/unit/openapi.test.ts` fails otherwise.

## 4. AI service (`apps/ai`)
- `app/schemas.py`: `HuddleSegmentIn(id, speaker ≤40, text ≤1000, block_key | None)`, `HuddleBlockIn(key, excerpt ≤1500)`, `HuddleNotesRequest(title, segments ≤800, blocks ≤200)`, `HuddleNotePoint(text, owner | None, segment_ids)`, `HuddleNotesData(summary, key_points, decisions, action_items, open_questions)`.
- `app/services/huddle_notes.py`: copy the provider fall-through + single deadline from `services/recap.py`; transcript wrapped with `wrap_untrusted` + `UNTRUSTED_RULE` (`app/guardrails.py`); prompt requires every point to cite segment ids; caps on item counts/lengths like recap.
- `app/routers/huddle_notes.py` (`POST /huddle-notes`, 502/503 like recap) + `include_router(..., dependencies=[Depends(require_internal)])` in `app/main.py`.

## 5. Tests (user-story style, real local Supabase — see testing memory)
- **Fakes:** add `"/huddle-notes"` to `DEFAULT_HANDLERS` in `test/support/fake-ai.ts` (cites the first segments). New `test/support/fake-livekit.ts` — tiny HTTP server answering LiveKit's Twirp RoomService paths (`ListParticipants`, `RemoveParticipant`, `UpdateParticipant`, `DeleteRoom`) and recording calls; tests set `LIVEKIT_URL` to it. No Docker LiveKit needed in CI.
- **Unit** (`test/unit/huddles-lib.test.ts`): `grantsFor` for all 4 roles; access rules; `focusAt` majority/tie/fallback; `resolveNotes` drops bad ids and picks anchors; routes 503 without LiveKit env.
- **Integration** (`test/integration/huddles.test.ts`), pattern of `test/integration/ledger.test.ts`:
  - owner starts `all`, a guest joins → decoded JWT identity = guest id, room = that huddle; viewer token has `canPublish: false`.
  - guest without key → 401; wrong key → 403; kicked member → 403; non-invitee (incl. owner) on a private huddle → 404.
  - starting `all` twice returns the same huddle.
  - segments: speaker forced to caller; viewer posting → 403; retry not duplicated; focus on a doc outside the room dropped.
  - ledger `member.kick` during a huddle → fake LiveKit receives `RemoveParticipant`.
- **E2E** (`test/e2e/huddle-journey.test.ts`): three people join, post focus changes + captions, end the huddle → notes `ready`, every point's anchor is a block they were looking at; refresh bumps version.
- **AI:** `apps/ai/tests/test_huddle_notes.py` mirroring `test_recap.py` (provider fallback, caps, injection text stays wrapped).

## 6. Build order (each step shippable)
1. Migration rename + `0028_huddles.sql` + shared schemas.
2. `lib/livekit.ts`, `lib/huddles.ts`, routes: list/create/join/leave/invite/uninvite/end + kick/role hook + OpenAPI + tests. → working voice huddles.
3. Segments, focus, transcript routes + tests. → captions persisted.
4. AI `/huddle-notes`, `lib/huddle-notes.ts`, notes routes + tests. → notes linked to passages.

## 7. Execution workflow — Antigravity (`agy`) writes ALL the code; Claude only briefs, tests and reviews
Goal: keep Claude's token cost low. Claude writes **no production code**.
`agy` is installed (`~/AppData/Local/agy/bin/agy`); local Supabase is already running in Docker.
1. Claude creates branch `feat/voice-huddles` off `main`.
2. Claude writes the plan file into the repo as `docs/HUDDLES_PLAN.md` so agy can read it instead of Claude pasting it.
3. For each build-order step (§6) Claude runs agy headless, in the background, with a short brief:
   `agy -p "Implement step N of docs/HUDDLES_PLAN.md. Follow existing patterns in the files it names. Write the step's tests too. Run typecheck, lint and the step's tests until green. Don't commit." --mode accept-edits --dangerously-skip-permissions --print-timeout 0`
4. Claude's part per step (cheap): `git diff --stat` + read only the risky parts (auth/identity, private-data leaks, LiveKit grants), run the step's user-story tests against local Supabase, and send any failures back with `agy -c -p "<findings>"`.
5. Claude commits each green step (with the attribution trailer). No push/PR unless asked.

## Verification
- `npm run supabase:start` then `npx supabase db reset` (migrations apply cleanly, incl. the renamed 0027).
- `npm run typecheck && npm run lint`
- `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`
- `cd apps/ai && uv run pytest`
- **Real LiveKit smoke test (Docker, no cloud keys needed):** `docker run -d --name lk-dev -p 7880:7880 livekit/livekit-server --dev --bind 0.0.0.0` (keys `devkey` / `secret`), start the backend with `LIVEKIT_URL=ws://127.0.0.1:7880`, then a script: create a room + `all` huddle, connect two participants with the minted tokens (`@livekit/rtc-node` in a scratch script), assert `participantCount` = 2, kick one via the ledger and assert they're disconnected, end the huddle and assert the LiveKit room is gone.
- Before deploying, the user adds LiveKit Cloud free-project keys to Render's env (`LIVEKIT_URL/API_KEY/API_SECRET`).
