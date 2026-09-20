# syntax=docker/dockerfile:1
# Collection pilot server image.
# Multi-stage: build frontend + server bundle with dev deps, then a minimal
# runtime with production deps only. Data lives on the /data volume (SQLite,
# WAL mode). Single process, single replica, non-root user.

# ---------- Stage 1: build ----------
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and build everything.
# `build:all` is expected to produce dist/ (frontend) and dist-server/ (server bundle, Node 24).
COPY . .
RUN npm run build:all

# ---------- Stage 2: runtime ----------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production

# Non-root runtime user. The /data directory is chowned so the named volume
# inherits the correct ownership on first use.
RUN addgroup -S collect && adduser -S collect -G collect \
  && mkdir -p /data && chown -R collect:collect /data

WORKDIR /app

# Production dependencies only (server may import zod / uuid at runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built artifacts from stage 1. dist/ is the static frontend, dist-server/ the server bundle.
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

# Persistent SQLite storage. Always mount a named volume here; the database
# is NOT baked into the image.
VOLUME ["/data"]

ENV HOST=0.0.0.0 \
    PORT=5200 \
    DATA_PATH=/data/collection.db \
    STATIC_DIR=/app/dist \
    SECURE_COOKIES=true
# NODE_ENV stays production here; for local HTTP trials override NODE_ENV=development
# together with SECURE_COOKIES=false at `docker run` (see runbook §3).

# ENTRY_CODE and ADMIN_TOKEN are REQUIRED at container start; there are no
# baked-in defaults. Pass them via `docker run -e` or compose environment.
# Never bake them into the image or commit them to the repo.

EXPOSE 5200

USER collect

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5200)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# server/main.ts is the entrypoint produced by `npm run build:all`.
CMD ["node", "dist-server/main.js"]
