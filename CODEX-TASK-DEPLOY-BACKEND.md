# Codex Task: Deploy Backend to Production Server

## Server Info
- Host: `root@8.129.133.52`
- Deploy path: `/opt/mediaclaw/server/`
- Node: v20.20.2
- PM2 already installed
- `.env` already configured at `/opt/mediaclaw/server/.env`
- Start script exists: `/opt/mediaclaw/server/start-mediaclaw-api.sh`

## Problem
Server has `dist/apps/aitoearn-ai/` but NOT `dist/apps/aitoearn-server/`. Need to deploy fresh build.

## Steps

### 1. Build locally (if not already done)
```bash
cd /Users/wes/projects/mediaclaw/server/project/aitoearn-backend
npx nx build aitoearn-server
```
Verify `dist/apps/aitoearn-server/src/main.js` exists.

### 2. Create deploy tarball
Create a tarball with ONLY what's needed to run:
```bash
cd /Users/wes/projects/mediaclaw/server/project/aitoearn-backend

# Include: dist/, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, 
# libs/ (for any runtime requires), apps/ configs, start script, .env template
tar czf /tmp/mediaclaw-backend.tar.gz \
  dist/ \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  nx.json \
  project.json \
  start-mediaclaw-api.sh \
  runtime.config.js \
  libs/mongodb/src/ \
  libs/assets/src/ \
  apps/aitoearn-server/config/ \
  apps/aitoearn-server/project.json
```

### 3. Upload to server
SSH can be flaky. Use `cat | ssh` pipe method (most reliable):
```bash
cat /tmp/mediaclaw-backend.tar.gz | ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 root@8.129.133.52 'cat > /tmp/mediaclaw-backend.tar.gz'
```

If that fails, try splitting:
```bash
split -b 5m /tmp/mediaclaw-backend.tar.gz /tmp/mcb-part-
for f in /tmp/mcb-part-*; do
  cat "$f" | ssh root@8.129.133.52 "cat >> /tmp/mediaclaw-backend.tar.gz"
done
```

### 4. Extract on server
```bash
ssh root@8.129.133.52 << 'REMOTE'
cd /opt/mediaclaw/server
# Backup old dist
mv dist dist.bak.$(date +%s) 2>/dev/null || true
# Extract new
tar xzf /tmp/mediaclaw-backend.tar.gz
ls -la dist/apps/aitoearn-server/src/main.js
REMOTE
```

### 5. Install production dependencies on server
```bash
ssh root@8.129.133.52 << 'REMOTE'
cd /opt/mediaclaw/server
# Install only production deps
npm install --production 2>&1 || pnpm install --prod 2>&1 || yarn install --production 2>&1
REMOTE
```

If pnpm is not installed: `npm install -g pnpm` first.

### 6. Start with PM2
```bash
ssh root@8.129.133.52 << 'REMOTE'
cd /opt/mediaclaw/server
# Start or restart the API
pm2 start start-mediaclaw-api.sh --name mediaclaw-api --interpreter bash 2>/dev/null || pm2 restart mediaclaw-api
sleep 5
pm2 list
pm2 logs mediaclaw-api --lines 20 --nostream
REMOTE
```

### 7. Verify
```bash
ssh root@8.129.133.52 << 'REMOTE'
# Health check
curl -s http://localhost:3000/api/health 2>/dev/null || curl -s http://localhost:3000/ | head -5
# Check PM2 status
pm2 show mediaclaw-api | grep status
REMOTE
```

## Success Criteria
1. `pm2 list` shows `mediaclaw-api` as `online`
2. `curl http://localhost:3000/api/health` returns 200 (or similar health endpoint)
3. No crash loops (restart count stays at 0 for >30 seconds)

## Troubleshooting
- If module not found errors: `cd /opt/mediaclaw/server && pnpm install --prod`
- If port conflict: `lsof -i :3000` and kill conflicting process
- If MongoDB connection fails: check `MONGODB_URI` in `.env` — current is `mongodb://127.0.0.1:27017/mediaclaw`
- Check MongoDB is running: `systemctl status mongod` or `mongosh --eval "db.version()"`

## Do NOT
- Do not modify any source code
- Do not change `.env` (already configured)
- Do not touch the frontend (`/opt/mediaclaw/web-next/`)
