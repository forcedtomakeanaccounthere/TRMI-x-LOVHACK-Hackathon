# Local setup

Run LinkRoom on your machine against a local Supabase in Docker. No cloud project is needed. Only the AI recap needs a real key.

All commands run from the repo root. They are written for bash: on Windows, use **Git Bash**, not PowerShell.

## 1. Install the prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node | 22.14+ (CI uses 22) | `node -v` |
| Python | 3.12+ | `python --version` |
| [uv](https://docs.astral.sh/uv/) | any recent | `uv --version` |
| [Docker](https://docs.docker.com/get-docker/) | running, not just installed | `docker info --format '{{.ServerVersion}}'` |

**Verify:** every check prints a version. If `docker info` prints a connection error, start Docker Desktop and wait for it to finish.

## 2. Install dependencies

```bash
npm ci                   # JS workspaces, including the Supabase CLI
npm run setup:ai         # Python deps for apps/ai
npm run setup:playwright # install Playwright Chromium browser & OS deps
```

`npm ci` may warn that esbuild and unrs-resolver install scripts are "not yet covered by allowScripts". That is safe to ignore.

**Verify:**

```bash
npx supabase --version   # 2.120.0
```

## 3. Start Supabase

```bash
npm run supabase:start
```

The first run downloads the Docker images and takes several minutes. It applies everything in [supabase/migrations](../supabase/migrations).

**Verify:**

```bash
curl -s -o /dev/null -w 'api %{http_code}\n' -H 'apikey: x' http://127.0.0.1:54321/auth/v1/health   # api 200
curl -s -o /dev/null -w 'mail %{http_code}\n' http://127.0.0.1:54324/                               # mail 200
```

If either line prints `000`, see [Troubleshooting](#troubleshooting).

## 4. Create the env files

```bash
cp .env.example .env
eval "$(npx supabase status -o env 2>/dev/null | tr -d '\r')"
sed -i.bak -E \
  -e "s|^(NEXT_PUBLIC_)?SUPABASE_URL=.*|\1SUPABASE_URL=$API_URL|" \
  -e "s|^(NEXT_PUBLIC_)?SUPABASE_ANON_KEY=.*|\1SUPABASE_ANON_KEY=$ANON_KEY|" \
  -e "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY|" \
  .env && rm .env.bak
grep '^NEXT_PUBLIC_' .env > apps/frontend/.env.local
```

This replaces any existing `.env`. Both files are gitignored. The keys are the shared demo keys every local Supabase uses, so they are not secrets, but never use them for a cloud project.

To use the AI recap, also set at least one of `NVIDIA_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY` or `ANTHROPIC_API_KEY` in `.env`. Everything else works without it.

`AI_INTERNAL_TOKEN` is optional locally. If you set it, the backend sends it to the AI service as `X-Internal-Token` and the AI service refuses requests without it. In production it is required on both hosts (`ENVIRONMENT=production` on the AI host), with the same value: generate one with `openssl rand -hex 32`.

**Verify:**

```bash
grep -cE '^(NEXT_PUBLIC_)?SUPABASE_[A-Z_]+=.+' .env   # 5
grep -c . apps/frontend/.env.local                    # 3
```

## 5. Start the apps

```bash
npm run dev
```

This runs all three apps in one terminal UI. Leave it running and use a second terminal for the checks below.

**Verify:**

```bash
curl -s http://localhost:4000/health                                  # {"ok":true,"service":"backend"}
curl -s http://localhost:8000/health                                  # {"ok":true,"service":"ai"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000        # 200
```

http://localhost:3000 should show the LinkRoom landing page. The frontend is still a placeholder at this stage, so there is no UI to sign up through yet. `/login` returns 404 until it is built.

## 6. Verify the full journey

This walks signup, email verification, login and room creation through the running backend. Paste it into the second terminal:

```bash
API=http://localhost:4000; MAIL=http://127.0.0.1:54324
EMAIL="smoke.$RANDOM@example.com"; PASSWORD='local-dev-pass-1'
post() { curl -s -w ' [%{http_code}]\n' -X POST "$API$1" -H 'Content-Type: application/json' ${3:+-H "Authorization: Bearer $3"} -d "$2"; }
CREDS="{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"

post /api/auth/signup "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke\"}"
post /api/auth/login "$CREDS"
sleep 1

ID=$(curl -s "$MAIL/api/v1/search?query=to:$EMAIL" | grep -o '"ID":"[^"]*"' | head -1 | cut -d'"' -f4)
LINK=$(curl -s "$MAIL/api/v1/message/$ID" | grep -o 'href=\\"[^\\]*' | head -1 | sed 's/href=\\"//; s/\\u0026/\&/g; s/&amp;/\&/g')
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' "$LINK"

TOKEN=$(post /api/auth/login "$CREDS" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
curl -s -w ' [%{http_code}]\n' "$API/api/auth/me" -H "Authorization: Bearer $TOKEN"
post /api/rooms/text '{"title":"Smoke","text":"Hello from local setup."}' "$TOKEN"
```

**Verify:** the output matches this, line by line:

| Step | Expected |
| --- | --- |
| Signup | `{"message":"Check your email to verify your account."} [201]` |
| Login before verifying | `{"error":"Please verify your email first"} [403]` |
| Verification link | `302 -> http://localhost:3000/login?verified=1` |
| Current user | `{"id":"…","email":"smoke.…@example.com","name":"Smoke"} [200]` |
| Create room | `{"id":"…"} [201]` |

To see the data, open the inbox at http://127.0.0.1:54324 and Studio at http://127.0.0.1:54323.

**AI recap:** `POST /api/rooms/:id/recap` returns `{"error":"Recap failed"} [502]` when no provider API key is set. That is expected.

## 7. Run the checks

Stop `npm run dev` first, then run these with Supabase still up:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:db            # Tests=40, Result: PASS
npm run test:integration   # 37 passed
npm run test:e2e           # 6 passed
npm run build
```

**Verify:** every command exits without errors. These are the same checks CI runs. The tests read local URLs and keys from `supabase status`, not from `.env`.

## Day to day

```bash
npm run supabase:start   # after a reboot; quick once the images are downloaded
npm run dev
npm run supabase:stop    # when finished; keeps your local data
```

After changing a migration, `npx supabase db reset` rebuilds the local database. It deletes all local data.

## Deploying

The frontend and backend talk across origins, so four `NEXT_PUBLIC_`/host env vars must agree with the deployed URLs. Getting them wrong shows up in the browser as `Access to fetch ... has been blocked by CORS policy` with `net::ERR_FAILED` on `http://localhost:4000/api/...`.

| Var | Where it is read | Set it on | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `apps/frontend/src/lib/api.ts` | The frontend build environment (Vercel) **before the build runs** | Inlined into the browser bundle at `next build` time; changing it afterwards has no effect until the next deploy. No trailing slash, e.g. `https://link-room-api.onrender.com`. |
| `WEB_ORIGIN` | `apps/backend/src/env.ts` | The backend host | Comma-separated allowlist of frontend origins for CORS. **Put the main frontend first**: email verification redirects users to the first entry, so a preview URL first sends verified users to the preview instead of the main site. Example: `https://link-room.vercel.app,https://link-room-git-main.vercel.app`. |
| `API_PUBLIC_URL` | The backend | The backend host | Public URL of the backend; email verification links point here. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `apps/frontend/src/lib/supabase.ts` | The frontend build environment | Public keys are fine to ship; use the cloud project's here, not the local demo keys. |

**Verify:** open the deployed frontend, sign in, and check the Network tab — requests must go to the deployed backend, not localhost. `npm run build` with the fallback set (no `NEXT_PUBLIC_API_URL`) prints `[api] NEXT_PUBLIC_API_URL is not set` to the browser console on localhost.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `failed to connect to the docker API` | Docker Desktop isn't running. Start it and retry. |
| `npm run test:db` fails with `Connection terminated unexpectedly`, or port 54324 gives an empty reply, while the API on 54321 works | Docker's port forwarding is stuck. This happened when Supabase started right after Docker Desktop. Run `npx supabase stop`, then `npm run supabase:start`. |
| `Local Supabase is not running` in the tests | Check `npx supabase status`, and start it if needed. |
| `supabase_vector_linkroom` keeps restarting in Docker | Seen on Windows. It only ships logs, and every check above passes with it restarting. |
| A port is already in use | The apps use 3000, 4000 and 8000. Supabase uses 54321 to 54324. Stop whatever holds the port. |
| Signup returns 429 | Signup, login and resend share a limit of 10 requests per 15 minutes per IP. Set `AUTH_RATE_LIMIT=1000` in `.env` and restart the backend. |
