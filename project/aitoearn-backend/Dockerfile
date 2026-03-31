FROM node:20-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY deps/package.json ./package.json
COPY deps/pnpm-lock.yaml ./pnpm-lock.yaml
COPY deps/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY deps/.npmrc ./.npmrc
COPY deps/apps ./apps
COPY deps/libs ./libs

RUN pnpm install --prod --frozen-lockfile

FROM node:20-slim AS production

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    fontconfig \
    libfreetype6 \
    fonts-noto-cjk \
    python3 \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY config.js ./config.js
COPY docker-runtime.cjs ./docker-runtime.cjs
COPY assets ./assets
COPY apps ./apps
COPY libs ./libs

EXPOSE 3002

CMD ["node", "docker-runtime.cjs", "apps/aitoearn-server/src/main.js"]
