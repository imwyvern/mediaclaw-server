# Codex Task: Build Docker Image Locally → Deploy to China Server

## 背景
服务器 `8.129.133.52`（中国阿里云）无法拉 Docker Hub 镜像。
后端已有新代码（消灭所有 stub），但 Docker 容器跑的还是旧镜像。
需要本地构建镜像 → 导出 tar → 上传 → 加载 → 重启容器。

## 服务器信息
- Host: `root@8.129.133.52`
- Docker Compose: `/opt/mediaclaw/server/docker-compose.production.yml`
- 当前运行中的 API 容器: `server-api-1`（healthy，image `mediaclaw/aitoearn-api:latest`）
- Nginx: `mediaclaw-nginx-1`（反代 port 80 → api:3002）
- MongoDB: `server-mongodb-1`（Docker 内，auth enabled，用户 mediaclaw）
- Redis: `server-redis-1`
- `.env.production` 已配好所有 key

## 步骤

### 1. 本地构建 Docker 镜像
```bash
cd /Users/wes/projects/mediaclaw/server/project/aitoearn-backend
docker build -t mediaclaw/aitoearn-api:latest -f Dockerfile .
```
如果本地没 Docker，用 `docker buildx` 或检查 `colima` / `orbstack` 是否可用。
如果本地 Docker 也不可用，跳到**备选方案**。

### 2. 导出镜像
```bash
docker save mediaclaw/aitoearn-api:latest | gzip > /tmp/mediaclaw-api-image.tar.gz
```

### 3. 上传到服务器
SSH 连接不稳定，用 `cat | ssh` 管道方式：
```bash
cat /tmp/mediaclaw-api-image.tar.gz | ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 root@8.129.133.52 'cat > /tmp/mediaclaw-api-image.tar.gz'
```
如果文件太大（>100MB），先 split：
```bash
split -b 20m /tmp/mediaclaw-api-image.tar.gz /tmp/mcimg-
for f in /tmp/mcimg-*; do cat "$f" | ssh root@8.129.133.52 "cat >> /tmp/mediaclaw-api-image.tar.gz"; done
```

### 4. 加载镜像并重启
```bash
ssh root@8.129.133.52 << 'REMOTE'
docker load < /tmp/mediaclaw-api-image.tar.gz
cd /opt/mediaclaw/server
docker compose -f docker-compose.production.yml up -d --force-recreate api
sleep 20
# 重新连接 nginx 网络（如果 container name 变了）
docker network connect --alias api mediaclaw-net server-api-1 2>/dev/null || true
docker restart mediaclaw-nginx-1
sleep 5
# 验证
docker ps | grep api
curl -s http://localhost:3002/health
curl -s http://localhost/health
REMOTE
```

### 5. 验证 stub 消除
```bash
ssh root@8.129.133.52 << 'REMOTE'
# 测试一个之前返回 stub 的接口
curl -s http://localhost:3002/api/mediaclaw/discovery/scan -H "Content-Type: application/json" | head -100
# 检查返回中不含 source: "stub"
REMOTE
```

## 备选方案（如果本地没 Docker）
不构建镜像，而是直接把编译好的 JS 注入到容器内：

```bash
# 在服务器上操作
# 1. 上传 dist/ 到服务器
cd /Users/wes/projects/mediaclaw/server/project/aitoearn-backend
tar czf /tmp/mc-dist.tar.gz dist/
cat /tmp/mc-dist.tar.gz | ssh root@8.129.133.52 'cat > /tmp/mc-dist.tar.gz'

# 2. 解压到临时目录
ssh root@8.129.133.52 'mkdir -p /tmp/mc-dist && cd /tmp/mc-dist && tar xzf /tmp/mc-dist.tar.gz'

# 3. 复制到容器内（注意路径映射！）
# 容器内结构: /app/apps/... /app/libs/... (编译后的 JS 直接放在 apps/ 和 libs/)
# 本地 dist/ 结构: dist/apps/... dist/libs/...
ssh root@8.129.133.52 << 'REMOTE'
# 复制编译后的 mediaclaw 服务
docker cp /tmp/mc-dist/dist/apps/aitoearn-server/src/core/mediaclaw/. server-api-1:/app/apps/aitoearn-server/src/core/mediaclaw/

# 复制编译后的 libs（schemas 等）
for lib in mongodb common helpers assets ali-sms aitoearn-auth aitoearn-queue aitoearn-ai-client; do
  docker cp /tmp/mc-dist/dist/libs/$lib/src/. server-api-1:/app/libs/$lib/src/ 2>/dev/null
done

# 复制其他修改过的文件
docker cp /tmp/mc-dist/dist/apps/aitoearn-server/src/config.js server-api-1:/app/apps/aitoearn-server/src/config.js 2>/dev/null

# 重启
docker restart server-api-1
sleep 20
docker ps | grep api
curl -s http://localhost:3002/health
REMOTE
```

**关键路径映射**：
- 本地 `dist/apps/aitoearn-server/src/` → 容器 `/app/apps/aitoearn-server/src/`
- 本地 `dist/libs/mongodb/src/` → 容器 `/app/libs/mongodb/src/`

### 6. 最终验证
```bash
ssh root@8.129.133.52 << 'REMOTE'
# Health check
curl -s http://localhost:3002/health && echo " OK"
# 前端通过 nginx
curl -so /dev/null -w "%{http_code}" http://localhost/auth && echo " auth"
curl -so /dev/null -w "%{http_code}" http://localhost/dashboard/discovery && echo " discovery"
# 检查 container 稳定（不 crash loop）
sleep 30
docker ps | grep api | grep -v "Restarting" && echo "STABLE" || echo "CRASH LOOP"
REMOTE
```

## 成功标准
1. `curl http://localhost:3002/health` → OK
2. `curl http://localhost/health` → OK（通过 nginx）
3. 容器 30 秒无重启
4. 前端页面全部 200

## 不要做
- 不改源代码
- 不改 .env.production
- 不改 docker-compose.production.yml
- 不动 nginx 配置
