---
name: mediaclaw-deploy
description: Build, upload, and deploy MediaClaw backend API and frontend to the production server (8.129.133.52). Handles Docker image build, transfer to China server, and zero-downtime restart.
metadata:
  short-description: Deploy MediaClaw API + Frontend to production
---

# MediaClaw Deploy

Use this skill when deploying the MediaClaw backend API, frontend dashboard, or both to the production server.

## Architecture

```
[Local Mac] --rsync/split--> [China Server 8.129.133.52]
                                  |
                                  ├── mediaclaw-nginx-1 (port 80/443) → reverse proxy
                                  ├── server-api-1 (port 3002) → NestJS API (Docker)
                                  ├── server-mongodb-1 → MongoDB 8.0 (Docker)
                                  ├── server-redis-1 → Redis 7 (Docker)
                                  └── mediaclaw-web (PM2, port 3001) → Next.js frontend
```

## Paths

| Item | Local Path | Server Path |
|------|-----------|-------------|
| Backend monorepo | `/Users/wes/projects/mediaclaw/server/project/aitoearn-backend` | `/opt/mediaclaw/server` |
| Docker Compose | (same) `docker-compose.production.yml` | `/opt/mediaclaw/server/docker-compose.production.yml` |
| Env file | (same) `.env.production` | `/opt/mediaclaw/server/.env.production` |
| Frontend | `/Users/wes/projects/mediaclaw/web` | `/opt/mediaclaw/web` |
| Nginx conf | `docker/nginx/mediaclaw.production.conf` | Docker volume mount |
| Build script | `scripts/build-docker.mjs` | N/A (local only) |
| Docker context | `tmp/docker-context/` (generated) | N/A |

## SSH

```bash
# Standard connection (flaky, always use timeouts)
ssh -o ConnectTimeout=15 -o ServerAliveInterval=10 root@8.129.133.52
```

⚠️ **SSH is unreliable** — connections drop frequently. Rules:
- Always add `-o ConnectTimeout=15 -o ServerAliveInterval=10`
- For file transfer: use `rsync -avP` (auto-resume) or `split` + `cat | ssh` chunks
- Batch multiple commands in one SSH session (reduce connections)
- Never use `scp` for large files (no resume)

## API Deploy (Full Image Rebuild)

### Step 1: Build NestJS

```bash
cd /Users/wes/projects/mediaclaw/server/project/aitoearn-backend
npx nx build aitoearn-server
```

Verify: `Successfully ran target build` in output. Fix any TypeScript errors before proceeding.

### Step 2: Prepare Docker Context

```bash
node scripts/build-docker.mjs aitoearn-server --context-only
```

This creates `tmp/docker-context/` with:
- `Dockerfile`
- `deps/` (stripped workspace for `pnpm install --prod`)
- `apps/`, `libs/` (compiled JS)
- `config.js`, `docker-runtime.cjs`, `assets/`

### Step 3: Build Docker Image

```bash
# Must target linux/amd64 (server is x86_64)
cd tmp/docker-context
docker build --platform linux/amd64 -t mediaclaw/aitoearn-api:latest .
```

Requires local Docker (colima x86build profile):
```bash
colima start x86build  # if not running
docker context use colima-x86build
```

### Step 4: Export Image

```bash
docker save mediaclaw/aitoearn-api:latest | gzip > /tmp/mediaclaw-api.tar.gz
```

Expected size: ~385MB

### Step 5: Upload to Server

**Option A: rsync (preferred, auto-resume)**
```bash
rsync -avP --timeout=30 /tmp/mediaclaw-api.tar.gz root@8.129.133.52:/tmp/mediaclaw-api.tar.gz
```

**Option B: split chunks (if rsync hangs)**
```bash
split -b 20m /tmp/mediaclaw-api.tar.gz /tmp/mcimg-
ssh root@8.129.133.52 'rm -f /tmp/mediaclaw-api.tar.gz'
for chunk in /tmp/mcimg-*; do
  cat "$chunk" | ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 root@8.129.133.52 'cat >> /tmp/mediaclaw-api.tar.gz' && echo "$(basename $chunk) OK"
done
# Verify size matches
ssh root@8.129.133.52 'wc -c < /tmp/mediaclaw-api.tar.gz'
```

### Step 6: Load Image & Restart

```bash
ssh -o ConnectTimeout=15 -o ServerAliveInterval=10 root@8.129.133.52 << 'REMOTE'
# Backup current image
docker tag mediaclaw/aitoearn-api:latest mediaclaw/aitoearn-api:rollback-$(date +%Y%m%d)

# Load new image
docker load < /tmp/mediaclaw-api.tar.gz

# Recreate API container
cd /opt/mediaclaw/server
docker compose -f docker-compose.production.yml up -d --force-recreate api

# Wait for health check
sleep 30
curl -s http://localhost:3002/health && echo " API OK" || echo " API FAILED"
docker inspect server-api-1 --format 'Restarts={{.RestartCount}}'
REMOTE
```

### Step 7: Reconnect Nginx (if needed)

```bash
ssh root@8.129.133.52 << 'REMOTE'
# Ensure API is on nginx network
docker network connect --alias api mediaclaw-net server-api-1 2>/dev/null || true
docker restart mediaclaw-nginx-1
sleep 5
curl -s http://localhost/health && echo " Nginx OK"
REMOTE
```

### Step 8: Cleanup

```bash
ssh root@8.129.133.52 'rm -f /tmp/mediaclaw-api.tar.gz && echo "Cleaned"'
# Local cleanup
rm -f /tmp/mediaclaw-api.tar.gz /tmp/mcimg-*
```

## Frontend Deploy

### Step 1: Build

```bash
cd /Users/wes/projects/mediaclaw/web
npm run build
```

### Step 2: Upload

```bash
rsync -avP --timeout=30 -e ssh .next/ root@8.129.133.52:/opt/mediaclaw/web/.next/
rsync -avP --timeout=30 -e ssh public/ root@8.129.133.52:/opt/mediaclaw/web/public/
```

### Step 3: Restart PM2

```bash
ssh root@8.129.133.52 'cd /opt/mediaclaw/web && pm2 restart mediaclaw-web'
```

## Verification Checklist

Run after every deploy:

```bash
ssh -o ConnectTimeout=10 root@8.129.133.52 << 'REMOTE'
echo "=== Health ==="
curl -s http://localhost:3002/health && echo " (API direct)"
curl -s http://localhost/health && echo " (via Nginx)"

echo "=== Frontend ==="
curl -so /dev/null -w "%{http_code}" http://localhost/auth && echo " /auth"
curl -so /dev/null -w "%{http_code}" http://localhost/dashboard && echo " /dashboard"

echo "=== Containers ==="
docker ps --format "table {{.Names}}\t{{.Status}}" | head -6

echo "=== Stability (30s) ==="
sleep 30
docker inspect server-api-1 --format 'Restarts={{.RestartCount}} Running={{.State.Running}}'
REMOTE
```

**Pass criteria:**
- API health: `OK`
- Nginx health: `OK`
- Frontend pages: `200`
- Restarts: `0` after 30 seconds
- Running: `true`

## Rollback

If the new image fails (crash loop):

```bash
ssh root@8.129.133.52 << 'REMOTE'
# List available backup images
docker images mediaclaw/aitoearn-api --format "{{.Tag}} {{.CreatedAt}}" | head -5

# Restore from backup
docker tag mediaclaw/aitoearn-api:rollback-YYYYMMDD mediaclaw/aitoearn-api:latest
cd /opt/mediaclaw/server
docker compose -f docker-compose.production.yml up -d --force-recreate api
sleep 30
curl -s http://localhost:3002/health
REMOTE
```

## Guardrails

- **Never** delete MongoDB or Redis volumes
- **Never** touch `mediaclaw-nginx-1` nginx config unless explicitly asked
- **Always** backup the current image tag before deploying a new one
- **Always** verify health after deploy — don't assume success
- If API crashes (restarts > 0), **immediately rollback** then investigate
- Do not modify `.env.production` on the server without explicit approval
- Keep at least 2 backup image tags on the server
- Monitor disk usage: server has 40GB total, keep >10GB free

## Known Issues

- Docker Hub is blocked in China — cannot `docker pull` on server
- SSH drops under heavy transfer — rsync handles this, raw `scp` doesn't  
- `colima x86build` must be running for cross-platform Docker builds
- Nginx container (`mediaclaw-nginx-1`) uses a separate compose project — after API recreate, may need `docker network connect` to re-alias
