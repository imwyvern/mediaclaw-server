# Task: Real Deployment to Alibaba Cloud

## Step 1: Build Docker Image (LOCAL, not remote!)
```bash
cd /Users/wes/projects/mediaclaw/server/project/aitoearn-backend
node scripts/build-docker.mjs aitoearn-server --context-only -o tmp/docker-context
docker build -t mediaclaw/aitoearn-api:latest --platform linux/amd64 tmp/docker-context
```

If build-docker.mjs fails, fallback to manual:
```bash
# Build locally first
pnpm nx build aitoearn-server
# Create simple Dockerfile that COPYs dist
docker build -t mediaclaw/aitoearn-api:latest --platform linux/amd64 -f Dockerfile .
```

## Step 2: Upload to Server
```bash
docker save mediaclaw/aitoearn-api:latest | gzip > /tmp/mediaclaw-api-img.tar.gz
scp /tmp/mediaclaw-api-img.tar.gz root@8.129.133.52:/tmp/
```

## Step 3: Server Setup
```bash
ssh root@8.129.133.52
# Install Docker if needed
which docker || (curl -fsSL https://get.docker.com | sh)
# Load image
docker load < /tmp/mediaclaw-api-img.tar.gz
# Stop PM2
pm2 delete mediaclaw-api 2>/dev/null
# Start with docker compose (api+mongodb+redis+nginx only)
```

## Step 4: Deploy Frontend
```bash
cd /Users/wes/projects/mediaclaw/web
npm run build
tar czf /tmp/mediaclaw-web.tar.gz .next/standalone .next/static public
scp /tmp/mediaclaw-web.tar.gz root@8.129.133.52:/tmp/
ssh root@8.129.133.52 "mkdir -p /opt/mediaclaw/web && cd /opt/mediaclaw/web && tar xzf /tmp/mediaclaw-web.tar.gz && cp -r .next/static .next/standalone/.next/"
# Start with PM2 on port 3001
ssh root@8.129.133.52 "cd /opt/mediaclaw/web/.next/standalone && PORT=3001 pm2 start server.js --name mediaclaw-web"
```

## Step 5: Nginx Config
Ensure nginx proxies:
- /api/* -> 127.0.0.1:3000 (backend)
- /* -> 127.0.0.1:3001 (frontend)

## Step 6: Verify
```bash
curl http://8.129.133.52/health
curl http://8.129.133.52/api/v1/health
curl http://8.129.133.52/  # Should return Next.js HTML
```

Print FULL DEPLOY COMPLETE when done.

## Rules
- SSH timeout: wait 60s, retry up to 3 times
- Server: 3.4GB RAM + 2GB swap, be memory-conscious
- Current state: PM2 mediaclaw-api already running on port 3000, MongoDB+Redis running natively
