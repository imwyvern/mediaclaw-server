# Task: Docker 化部署 + 按 PRD 继续开发

## 背景
- 服务器: root@8.129.133.52, Ubuntu 24.04, 3.4GB RAM + 2GB swap, 40GB disk
- 当前: API 通过 PM2 裸跑成功, MongoDB + Redis 裸装运行, health OK
- Docker 未安装
- 项目已有 docker-compose.production.yml + Dockerfile + nginx 配置
- PRD: /Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v1.5.md (实际是 v1.6)

## Part A: Docker 化部署

### A1: 安装 Docker
SSH 到 root@8.129.133.52 安装 Docker Engine + Docker Compose plugin

### A2: 调整 docker-compose.production.yml 内存限制
服务器只有 3.4GB + 2GB swap，调低 mem_limit:
- API: 768m
- Worker: 不启动（注释掉或 profiles）
- MongoDB: 512m
- Redis: 256m
- RustFS: 不启动（Phase 1 不需要对象存储）
- Nginx: 128m

总计约 1.7GB，留足系统空间。用 docker compose profiles 管理可选服务。

### A3: 创建 .env.production
- MONGODB_USERNAME=mediaclaw
- MONGODB_PASSWORD=随机生成安全密码
- REDIS_PASSWORD=随机生成
- JWT_SECRET=随机生成
- 其他参照 docker-compose.production.yml 需要的变量

### A4: 构建 Docker Image
**在本地 Mac 上 build**（不在服务器上！服务器 OOM）:
```bash
docker build -t mediaclaw/aitoearn-api:latest --platform linux/amd64 .
docker save mediaclaw/aitoearn-api:latest | gzip > /tmp/mediaclaw-api.tar.gz
scp /tmp/mediaclaw-api.tar.gz root@8.129.133.52:/tmp/
ssh root@8.129.133.52 "docker load < /tmp/mediaclaw-api.tar.gz"
```

### A5: 数据迁移
1. mongodump 导出裸 MongoDB 数据
2. 停止裸 MongoDB + Redis + PM2
3. docker compose up -d mongodb redis （先启基础设施）
4. mongorestore 到 Docker MongoDB
5. docker compose up -d api nginx （启应用）

### A6: 验证
- `curl http://8.129.133.52/health` → OK
- `curl http://8.129.133.52/api/v1/health` → OK
- `docker compose logs api --tail 20` 无报错
- 输出 "DOCKER DEPLOY COMPLETE"

## Part A7: 前端部署
前端项目在 /Users/wes/projects/mediaclaw/web (Next.js, output: "standalone")

1. 本地 build: `cd /Users/wes/projects/mediaclaw/web && npm run build`
2. standalone 产物在 `.next/standalone/` + `.next/static/`
3. 打包: `tar czf /tmp/mediaclaw-web.tar.gz .next/standalone .next/static public`
4. scp 到服务器: `scp /tmp/mediaclaw-web.tar.gz root@8.129.133.52:/tmp/`
5. 解压到 /opt/mediaclaw/web/
6. 用 PM2 或 Docker 启动: `node .next/standalone/server.js` (端口 3001)
7. Nginx 配置: location / → proxy_pass http://127.0.0.1:3001

或者如果走 Docker: 写一个简单的前端 Dockerfile，加到 docker-compose.production.yml

## Part B: 按 PRD 继续开发

读 PRD Section 8 路线图，识别 Phase 1a 需要的功能，继续开发。

## 规则
- 不在服务器上 docker build
- 本地 build 用 --platform linux/amd64
- SSH 超时等 60s 重试（最多 3 次）
- Conventional Commits
- 提交前 build 通过
