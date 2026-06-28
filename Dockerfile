# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk upgrade --no-cache && corepack enable && corepack prepare pnpm@11 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Remove host-local store-dir so pnpm uses its default inside the container
RUN sed -i '/^store-dir/d' .npmrc

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build


# ---- Production stage ----
# Use Debian slim — Alpine's musl causes issues with compiled Python (dbt) deps
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Install Python + dbt-postgres + the curated package set Python cells run
# against (see src/lib/server/python-runner.ts) — baked in so Python cells
# need zero setup in this image, no uv/venv bootstrap required.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-venv \
    git \
    curl \
  && pip install dbt-postgres pandas numpy pyarrow plotly jedi --break-system-packages \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN sed -i '/^store-dir/d' .npmrc

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/build ./build

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

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-venv \
    git \
    curl \
  && pip install dbt-postgres pandas numpy pyarrow plotly jedi --break-system-packages \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN sed -i '/^store-dir/d' .npmrc
RUN pnpm install --frozen-lockfile

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "5173"]
