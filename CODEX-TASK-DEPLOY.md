# MediaClaw Production Deployment to 8.129.133.52

## Server Info
- Host: `root@8.129.133.52` (SSH key auth, no password needed)
- OS: Ubuntu 24.04 x86_64
- RAM: 1.6GB (low! optimize accordingly)
- Disk: 40GB (36GB free)
- Docker: NOT installed yet

## ⚠️ IMPORTANT: Low Memory Server (1.6GB)
This server has very limited RAM. DO NOT use docker compose with multiple containers.
Use lightweight deployment instead:
- Node.js direct (no Docker overhead)
- MongoDB Atlas or remote DB (don't run MongoDB locally)
- Redis in low-memory mode or skip for now
- PM2 for process management

## Task 1: Install Dependencies on Server
SSH into `root@8.129.133.52` and run:
```bash
# Node.js 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
npm install -g pnpm pm2

# Git
apt update && apt install -y git

# Verify
node -v && pnpm -v && pm2 -v && git --version
```

## Task 2: Clone & Build Backend
```bash
# Clone
mkdir -p /opt/mediaclaw && cd /opt/mediaclaw
git clone git@github.com:imwyvern/mediaclaw-server.git server
cd server/project/aitoearn-backend

# Install deps
pnpm install --frozen-lockfile

# Build
npx nx build aitoearn-server --skip-nx-cache

# Verify build output exists
ls dist/apps/aitoearn-server/main.js
```

If git clone fails (no SSH key on server), use HTTPS:
```bash
git clone https://github.com/imwyvern/mediaclaw-server.git server
```

If the repo is private, generate a deploy token on GitHub or use `git clone` from local and rsync:
```bash
# From local machine:
rsync -avz --exclude node_modules --exclude .git ~/projects/mediaclaw/server/project/aitoearn-backend/ root@8.129.133.52:/opt/mediaclaw/server/
```

## Task 3: Create Environment Config
Create `/opt/mediaclaw/server/.env`:
```bash
cat > /opt/mediaclaw/server/.env << 'EOF'
# Server
NODE_ENV=production
PORT=3000

# MongoDB (use Atlas free tier or remote)
MONGODB_URI=mongodb://localhost:27017/mediaclaw

# Redis (optional, skip if memory tight)
# REDIS_HOST=localhost
# REDIS_PORT=6379

# JWT
JWT_SECRET=mediaclaw-jwt-secret-change-in-production
JWT_EXPIRES_IN=2h
JWT_REFRESH_EXPIRES_IN=7d

# SMS (placeholder)
SMS_PROVIDER=aliyun
SMS_ACCESS_KEY=placeholder
SMS_ACCESS_SECRET=placeholder

# XorPay (placeholder)
XORPAY_APP_ID=placeholder
XORPAY_APP_SECRET=placeholder

# RustFS/S3 Storage
STORAGE_ENDPOINT=placeholder
STORAGE_ACCESS_KEY=placeholder
STORAGE_SECRET_KEY=placeholder
STORAGE_BUCKET=mediaclaw
EOF
```

## Task 4: Install MongoDB (Lightweight)
Since only 1.6GB RAM, use MongoDB with WiredTiger cache limited:
```bash
# Install MongoDB 7.x
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list
apt update && apt install -y mongodb-org

# Limit memory: 256MB WiredTiger cache
cat > /etc/mongod.conf << 'EOF'
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 0.25
systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log
net:
  port: 27017
  bindIp: 127.0.0.1
EOF

systemctl start mongod
systemctl enable mongod
```

## Task 5: Start with PM2
```bash
cd /opt/mediaclaw/server

# Start API server
pm2 start dist/apps/aitoearn-server/main.js --name mediaclaw-api \
  --max-memory-restart 512M \
  --env production \
  --node-args="--max-old-space-size=512"

# Save PM2 config for auto-restart
pm2 save
pm2 startup

# Verify
pm2 status
curl http://localhost:3000/api/v1/health
```

## Task 6: Setup Nginx Reverse Proxy
```bash
apt install -y nginx

cat > /etc/nginx/sites-available/mediaclaw << 'EOF'
server {
    listen 80;
    server_name _;

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    # Frontend (placeholder, will deploy Next.js later)
    location / {
        root /opt/mediaclaw/web;
        try_files $uri $uri/ /index.html;
    }
}
EOF

ln -sf /etc/nginx/sites-available/mediaclaw /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
systemctl enable nginx
```

## Task 7: Deploy Frontend (Static Export)
From LOCAL machine, build and upload:
```bash
# Build frontend as static export
cd ~/projects/mediaclaw/web  # or /Volumes/External/mac-offload/projects/mediaclaw/web
# Check if next.config has output: 'export', if not add it
npm run build

# Upload to server
rsync -avz out/ root@8.129.133.52:/opt/mediaclaw/web/
# OR if using .next/standalone:
rsync -avz .next/standalone/ root@8.129.133.52:/opt/mediaclaw/web/
```

## Task 8: Verify Deployment
```bash
# Health check
curl http://8.129.133.52/api/v1/health
curl http://8.129.133.52/

# Check PM2 status
pm2 status
pm2 logs mediaclaw-api --lines 20

# Check resources
free -h
```

## After ALL tasks:
Print:
- Server URL: http://8.129.133.52
- API URL: http://8.129.133.52/api/v1
- Health: http://8.129.133.52/api/v1/health
- PM2 status
- Memory usage

Print "DEPLOYMENT COMPLETE" at end.
