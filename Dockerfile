# One container for apps/backend and apps/ai (Render: one Docker web service).
# apps/ai listens on 127.0.0.1:8000 inside the container only; apps/backend listens on $PORT and
# reaches it at AI_SERVICE_URL=http://127.0.0.1:8000. See deploy/start.sh and docs/DEPLOY.md.

# --- Build apps/backend (TypeScript, with @linkroom/shared bundled in) ---
FROM node:22-bookworm-slim AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=@linkroom/backend --workspace=@linkroom/shared --include-workspace-root=false --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
RUN npm run build --workspace=@linkroom/backend

# --- Runtime ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
WORKDIR /app

# uv (from PyPI) installs Python 3.12 and apps/ai's locked dependencies.
# libreoffice-nogui and fonts convert uploaded DOCX/PPTX/PPT documents to PDF.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-pip libreoffice-nogui fonts-dejavu-core fonts-liberation \
    && pip3 install --no-cache-dir --break-system-packages uv==0.9.5 \
    && rm -rf /var/lib/apt/lists/*

COPY apps/ai/pyproject.toml apps/ai/uv.lock apps/ai/
RUN cd apps/ai && uv python install 3.12 && uv sync --locked --no-dev --no-install-project
COPY apps/ai/app apps/ai/app

# apps/backend: production dependencies, the build, and Chromium for the link-import fallback.
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace=@linkroom/backend --include-workspace-root=false --ignore-scripts \
    && npx --workspace=@linkroom/backend playwright install --with-deps chromium \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*
COPY --from=backend-build /app/apps/backend/dist apps/backend/dist

COPY deploy/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

EXPOSE 4000
CMD ["start.sh"]
