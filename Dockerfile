# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk upgrade --no-cache && corepack enable && corepack prepare pnpm@11 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Remove host-local store-dir so pnpm uses the BuildKit cache mount path below
RUN sed -i '/^store-dir/d' .npmrc

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build


# ---- Production stage ----
# Use Debian slim — Alpine's musl causes issues with compiled Python (dbt) deps
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Which dbt adapters to pre-warm as isolated venvs (/opt/dbt-venvs/<adapter>).
# Deployment config, not code: override at build time
# (`docker build --build-arg DBT_ADAPTERS=duckdb,trino ...`). Anything else a
# mounted project targets is provisioned at container boot instead
# (see src/lib/server/dbt-venvs.ts).
ARG DBT_ADAPTERS=duckdb,postgres,trino
ENV DBT_VENVS_DIR=/opt/dbt-venvs

# Install Python + venv tooling + the curated package set Python cells run
# against (see src/lib/server/python-runner.ts) — baked in so Python cells
# need zero setup in this image, no uv/venv bootstrap required.
# NOTE: no dbt packages in system Python by design — each adapter lives in
# its own venv (pre-warmed below) so adapters can never break each other.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-venv \
    git \
    curl \
  && pip install pandas numpy pyarrow plotly jedi --break-system-packages \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN sed -i '/^store-dir/d' .npmrc

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# Chromium for headless notebook-screenshot rendering (src/lib/server/notebook-render.ts).
# playwright-core is a runtime dependency but its browser binary isn't fetched by
# --ignore-scripts, so install it explicitly here.
RUN npx --yes playwright-core install --with-deps chromium

COPY --from=builder /app/build ./build
COPY scripts ./scripts

# Pre-warm isolated dbt venvs for DBT_ADAPTERS (best-effort: a failure here
# only defers to boot-time provisioning, it never fails the image build).
RUN --mount=type=cache,id=dbt-pip,target=/root/.cache/pip \
    sh ./scripts/dbt-venvs-warm.sh "$DBT_ADAPTERS"

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "build/index.js"]


# ---- Dev stage (live reload via docker-compose.dev.yml) ----
# Same base as the production runner so dbt/python behave identically; source is
# bind-mounted at runtime (see docker-compose.dev.yml), this just bakes the toolchain in.
FROM node:22-bookworm-slim AS dev
WORKDIR /app

ARG DBT_ADAPTERS=duckdb,postgres,trino
ENV DBT_VENVS_DIR=/opt/dbt-venvs

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-venv \
    git \
    curl \
  && pip install pandas numpy pyarrow plotly jedi --break-system-packages \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Pre-warm isolated dbt venvs (best-effort; boot provisioning is the fallback).
# Only the warm script is copied — the rest of the source arrives via bind-mount.
COPY scripts/dbt-venvs-warm.sh ./scripts/dbt-venvs-warm.sh
RUN --mount=type=cache,id=dbt-pip,target=/root/.cache/pip \
    sh ./scripts/dbt-venvs-warm.sh "$DBT_ADAPTERS"

RUN corepack enable && corepack prepare pnpm@11 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN sed -i '/^store-dir/d' .npmrc

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile && \
    cp -r /root/.local/share/pnpm/store /pnpm-store

# Chromium for headless notebook-screenshot rendering (src/lib/server/notebook-render.ts).
RUN npx --yes playwright-core install --with-deps chromium

EXPOSE 5173

# Run pnpm install with the baked-in store before starting the dev server.
# This ensures node_modules are up-to-date even when the anonymous volume
# (docker-compose.dev.yml: /app/node_modules) is stale after a --build.
# CI=true lets pnpm purge without a TTY; --store-dir overrides the host
# .npmrc's macOS store path that comes in via the source bind-mount.
CMD ["sh", "-c", "CI=true pnpm install --frozen-lockfile --store-dir /pnpm-store && exec pnpm dev --host 0.0.0.0 --port 5173"]
