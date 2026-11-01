# Deploying the API (backend + AI in one container)

`Dockerfile` at the repo root builds one image with both `apps/backend` and `apps/ai`.
`deploy/start.sh` starts apps/ai on `127.0.0.1:8000` (inside the container only), waits for it,
then starts apps/backend on `$PORT`. If either process exits, the container exits, so the host
restarts both. The frontend stays on Vercel.

## Render

1. Open the backend web service → **Settings**.
2. **Runtime / Language**: Docker. **Dockerfile path**: `./Dockerfile`. **Docker build context**: `.`
   (the repo root). Leave the build and start commands empty: the image's `CMD` runs `start.sh`.
3. **Instance type**: at least 1 GB of memory. Node, Python and the Chromium used by the
   link-import fallback share the container; the free 512 MB instance can run out.
4. **Health check path**: `/health`.
5. **Environment**: one set of variables for both services (Render doesn't read `.env` files):

| Variable | Value |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → Project settings → API |
| `AI_INTERNAL_TOKEN` | any long random value (`openssl rand -hex 32`); required in production |
| `ENVIRONMENT` | `production` |
| `API_PUBLIC_URL` | this service's URL, e.g. `https://linkroom-api.onrender.com` |
| `WEB_ORIGIN` | the frontend's URL |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | your mail account; `SMTP_HOST` is required in production |
| `AI_PROVIDERS` | `nvidia,gemini,mistral,anthropic` |
| `NVIDIA_API_KEY` / `GEMINI_API_KEY` / `MISTRAL_API_KEY` / `ANTHROPIC_API_KEY` | at least one; NVIDIA also gives embeddings and the AI-lens vision model |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIM` | `nvidia`, `nvidia/llama-3.2-nv-embedqa-1b-v2`, `1024` |
| `MODERATION_ENABLED` | `true` (uses `MISTRAL_API_KEY` when set) |
| `YT_PROXY_URL` | optional: an http(s) proxy for YouTube transcripts, which YouTube often blocks from cloud hosts |

Don't set `PORT` (Render does), `SERVER_PORT` or `AI_SERVICE_URL`: `start.sh` sets them so the
backend reaches apps/ai at `http://127.0.0.1:8000`.

6. Deploy. The logs show both services; check `https://<service>/health`.

## Locally

```bash
docker build -t linkroom-api .
docker run --rm -p 4000:4000 -e PORT=4000 --env-file .env linkroom-api
```
