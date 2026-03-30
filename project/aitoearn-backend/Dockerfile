FROM node:20-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json ./
COPY apps ./apps
COPY libs ./libs

RUN pnpm install --frozen-lockfile

FROM deps AS build

RUN npx nx build aitoearn-server --skip-nx-cache \
  && node -e "const fs = require('node:fs'); const path = 'dist/apps/aitoearn-server/main.js'; fs.writeFileSync(path, `if (!process.argv.includes('-c') && !process.argv.includes('--config')) process.argv.push('-c', 'config.js'); require('./src/main.js');\\n`)"

FROM node:20-slim AS production

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist/libs ./libs
COPY --from=build /app/apps/aitoearn-server/config/config.js ./config.js
COPY package.json ./

EXPOSE 3002

CMD ["node", "dist/apps/aitoearn-server/main.js"]
