# MediaClaw Deploy V2 — Local Build + Upload Strategy

## ⚠️ KEY LESSON: Server only has 4GB RAM + 2GB swap
- `nx build` and `pnpm install --dev` OOM on this server
- Strategy: BUILD LOCALLY → upload dist + node_modules → start on server
- Server: `root@8.129.133.52` (SSH key auth, Ubuntu 24.04)

## Pre-requisite: All libs already built locally
All 18 projects are built in `dist/` (verified working).

## Task 1: Fix Schema Error
The `ApiKey.lastUsedAt` field throws `CannotDetermineTypeError` at runtime.
Fix in `libs/mongodb/src/schemas/api-key.schema.ts`:
- Find `lastUsedAt` field and add explicit type: `@Prop({ type: Date, required: false })`
- Then rebuild: `npx nx build aitoearn-server --skip-nx-cache`

Also check for any other schema fields that use union types (e.g. `Date | null`) and fix them.

## Task 2: Create Production Deploy Script
Create `scripts/deploy.sh`:
```bash
#!/bin/bash
set -e
SERVER="root@8.129.133.52"
REMOTE_DIR="/opt/mediaclaw/server"

echo "=== Step 1: Build locally ==="
export NODE_OPTIONS="--max-old-space-size=4096"
npx nx run-many --target=build --all --skip-nx-cache

echo "=== Step 2: Upload dist (pre-built) ==="
tar czf /tmp/mediaclaw-dist.tar.gz dist/
scp /tmp/mediaclaw-dist.tar.gz $SERVER:/tmp/

echo "=== Step 3: Extract + configure on server ==="
ssh $SERVER "
cd $REMOTE_DIR
rm -rf dist
tar xzf /tmp/mediaclaw-dist.tar.gz

# Create runtime tsconfig for path resolution
cat > tsconfig.runtime.json << 'TSEOF'
{
  \"compilerOptions\": {
    \"baseUrl\": \".\",
    \"paths\": {
      \"@yikart/*\": [\"dist/libs/*/src\"]
    }
  }
}
TSEOF

# Create/update .env
cat > .env << 'ENVEOF'
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/mediaclaw
JWT_SECRET=mediaclaw-prod-jwt-secret-2026
JWT_EXPIRES_IN=2h
JWT_REFRESH_EXPIRES_IN=7d
ENVEOF

# Stop existing
pm2 delete mediaclaw-api 2>/dev/null || true

# Start with tsconfig-paths
TS_NODE_PROJECT=$REMOTE_DIR/tsconfig.runtime.json \
pm2 start dist/apps/aitoearn-server/src/main.js --name mediaclaw-api \
  --max-memory-restart 1G \
  --node-args='-r tsconfig-paths/register --max-old-space-size=1024'

pm2 save
sleep 8
pm2 list
curl -s -m 5 http://localhost:3000/ || echo 'Starting...'
"

echo "=== Deploy complete ==="
echo "API: http://8.129.133.52/api/v1"
```

## Task 3: Fix + Build + Deploy
1. Fix the ApiKey schema error (Task 1)
2. Rebuild locally: `npx nx run-many --target=build --all --skip-nx-cache`
3. Run `bash scripts/deploy.sh`
4. Verify: `curl http://8.129.133.52:3000/`
5. If API starts successfully, configure nginx:
```bash
ssh root@8.129.133.52 '
cat > /etc/nginx/sites-available/mediaclaw << NGEOF
server {
    listen 80;
    server_name _;
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_cache_bypass \$http_upgrade;
    }
    location / {
        root /opt/mediaclaw/web;
        try_files \$uri \$uri/ /index.html;
    }
}
NGEOF
ln -sf /etc/nginx/sites-available/mediaclaw /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
'
```

## Task 4: Commit Deploy Infra
- Commit `scripts/deploy.sh` + schema fix: `fix(deploy): production deploy script + schema type fixes`
- Push to main

## IMPORTANT RULES:
- **DO NOT run nx build on the remote server** — it will OOM
- **DO NOT run pnpm install --dev on server** — workspace devDeps are too heavy
- Only upload pre-built artifacts from local machine
- Server already has: Node 20, pnpm, PM2, MongoDB, Redis, Nginx, 2GB swap
- Working dir: `project/aitoearn-backend/`

Print "DEPLOY V2 COMPLETE" at end.
