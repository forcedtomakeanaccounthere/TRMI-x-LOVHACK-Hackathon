#!/usr/bin/env bash
# Starts apps/ai on 127.0.0.1:8000, waits for it, then apps/backend on $PORT (Render sets it).
# If either process exits, the other is stopped and the container exits, so the host restarts both.
set -euo pipefail

AI_PORT="${AI_PORT:-8000}"
export SERVER_PORT="${PORT:-${SERVER_PORT:-4000}}"
export AI_SERVICE_URL="${AI_SERVICE_URL:-http://127.0.0.1:${AI_PORT}}"

cd /app/apps/ai
uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port "$AI_PORT" &
ai_pid=$!

# The backend resumes indexing at startup, so give apps/ai a moment to come up first.
for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:${AI_PORT}/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
    break
  fi
  if ! kill -0 "$ai_pid" 2>/dev/null; then
    echo "[start] apps/ai exited during startup" >&2
    exit 1
  fi
  sleep 1
done

cd /app/apps/backend
node dist/index.js &
backend_pid=$!

trap 'kill -TERM "$ai_pid" "$backend_pid" 2>/dev/null || true' TERM INT
set +e
wait -n "$ai_pid" "$backend_pid"
status=$?
echo "[start] a process exited (status $status); stopping the container" >&2
kill -TERM "$ai_pid" "$backend_pid" 2>/dev/null || true
wait
exit "$status"
