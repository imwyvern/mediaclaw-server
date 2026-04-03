# MediaClaw CI/CD Verification & Enhancement

## Context
Working dir: `project/aitoearn-backend/`
Remote: `git@github.com:imwyvern/mediaclaw-server.git`
CI files exist at `.github/workflows/ci.yml` and `deploy.yml`

## Task 1: Verify Local Build Pipeline
Run the full CI pipeline locally and fix any issues:
```bash
# 1. Lint
npx nx lint aitoearn-server --skip-nx-cache

# 2. Build  
npx nx build aitoearn-server --skip-nx-cache

# 3. Test (if target exists)
npx nx test aitoearn-server --skip-nx-cache
```
- Fix ALL lint errors/warnings
- Fix ALL build errors
- Fix ALL test failures
- If test target doesn't exist, create it in `apps/aitoearn-server/project.json`

## Task 2: Verify & Fix CI Workflow
Review `.github/workflows/ci.yml`:
- Ensure it correctly references pnpm (not npm/yarn)
- Ensure node version matches project (20)
- Verify the docker build step references correct Dockerfile
- Check if `scripts/build-docker.mjs` exists; if not, create it or replace with standard `docker build` command
- Verify `.github/workflows/deploy.yml` has correct SSH deploy steps
- Add Dockerfile for the NestJS app if missing:
  - Multi-stage build (deps → build → production)
  - Based on node:20-slim
  - Copy dist output from nx build
  - Expose port 3000
  - CMD ["node", "dist/apps/aitoearn-server/main.js"]

## Task 3: Add Dockerfile for Production
Create `Dockerfile` in project root (if not exists):
```dockerfile
# Stage 1: Dependencies
FROM node:20-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile --prod=false

# Stage 2: Build
FROM deps AS build
COPY . .
RUN npx nx build aitoearn-server --skip-nx-cache

# Stage 3: Production
FROM node:20-slim AS production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/apps/aitoearn-server/main.js"]
```

## Task 4: Push & Verify GitHub Actions
- Ensure all changes are committed
- `git push origin main`
- Print the GitHub Actions URL: `https://github.com/imwyvern/mediaclaw-server/actions`
- Print summary of what CI will do on push

## After ALL tasks:
1. All lint/build/test must pass locally
2. Commit fixes: `fix(ci): verify and enhance CI/CD pipeline`
3. Push to main
4. Print "CI/CD PIPELINE VERIFIED AND PUSHED" at end
