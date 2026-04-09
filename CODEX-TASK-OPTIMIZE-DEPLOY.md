# Codex Task: 优化生产环境部署

## 当前问题

### 1. 重复容器浪费资源
服务器上有两套 MongoDB + Redis：
- `server-mongodb-1` + `server-redis-1`（新启动的，API 连接的）
- `mediaclaw-mongodb-1` + `mediaclaw-redis-1`（旧的，41 小时前启动的，没人用了）

**修复**：停掉并删除旧的 `mediaclaw-mongodb-1` 和 `mediaclaw-redis-1`：
```bash
ssh root@8.129.133.52 'docker stop mediaclaw-mongodb-1 mediaclaw-redis-1 && docker rm mediaclaw-mongodb-1 mediaclaw-redis-1'
```
⚠️ 先确认旧 MongoDB 里没有数据（或数据已被新的覆盖）。检查 volume：
```bash
ssh root@8.129.133.52 'docker inspect mediaclaw-mongodb-1 --format "{{range .Mounts}}{{.Name}} {{.Destination}}{{println}}{{end}}"'
ssh root@8.129.133.52 'docker inspect server-mongodb-1 --format "{{range .Mounts}}{{.Name}} {{.Destination}}{{println}}{{end}}"'
```
如果两个用同一个 volume → 安全删除旧容器。如果不同 volume → 需要先迁移数据。

### 2. 新代码部署到容器
当前容器跑的是 4/1 构建的旧镜像。本地有新代码（stub 全部消灭了）。

**方案**：把 `dist/` 编译产物直接 `docker cp` 进容器：

```bash
# 本地打包 dist
cd /Users/wes/projects/mediaclaw/server/project/aitoearn-backend
tar czf /tmp/mc-dist-only.tar.gz dist/

# 上传
cat /tmp/mc-dist-only.tar.gz | ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 root@8.129.133.52 'cat > /tmp/mc-dist-only.tar.gz'

# 解压到临时目录
ssh root@8.129.133.52 'rm -rf /tmp/mc-dist && mkdir -p /tmp/mc-dist && cd /tmp/mc-dist && tar xzf /tmp/mc-dist-only.tar.gz'

# 关键路径映射！容器内不用 dist/ 前缀
# 本地: dist/apps/aitoearn-server/src/ → 容器: /app/apps/aitoearn-server/src/
# 本地: dist/libs/*/src/ → 容器: /app/libs/*/src/

# 复制到容器
ssh root@8.129.133.52 << 'REMOTE'
# 复制所有 mediaclaw 服务代码
docker cp /tmp/mc-dist/dist/apps/aitoearn-server/src/core/mediaclaw/. server-api-1:/app/apps/aitoearn-server/src/core/mediaclaw/

# 复制修改过的 libs
for lib in mongodb common helpers assets ali-sms aitoearn-auth aitoearn-queue aitoearn-ai-client aitoearn-server-client channel-db nest-mcp redis redlock ali-oss aws-s3 mail; do
  if [ -d "/tmp/mc-dist/dist/libs/$lib/src/" ]; then
    docker cp /tmp/mc-dist/dist/libs/$lib/src/. server-api-1:/app/libs/$lib/src/ 2>/dev/null && echo "  copied $lib"
  fi
done

# 复制 video-task-lifecycle.util.js 修复
docker cp /tmp/mc-dist/dist/apps/aitoearn-server/src/core/mediaclaw/video-task-lifecycle.util.js server-api-1:/app/apps/aitoearn-server/src/core/mediaclaw/ 2>/dev/null

echo "=== Restart ==="
docker restart server-api-1
sleep 20

# 验证
echo "=== Health ==="
curl -s http://localhost:3002/health
echo ""
echo "=== Container status ==="
docker ps | grep api
echo "=== Stability check ==="
sleep 15
docker ps | grep api | grep -v "Restarting" && echo "STABLE" || echo "CRASH LOOP"
REMOTE
```

### 3. 前端 PM2 进程端口冲突检查
`mediaclaw-web` PM2 进程在端口 3001。nginx 的 frontend upstream 指向 `host.docker.internal:3001`。确认它们对齐。

```bash
ssh root@8.129.133.52 'pm2 list && echo "---" && curl -so /dev/null -w "%{http_code}" http://localhost:3001 && echo " (port 3001)"'
```

### 4. 清理临时文件
```bash
ssh root@8.129.133.52 'rm -f /tmp/mediaclaw-*.tar.gz /tmp/mc-dist*.tar.gz /tmp/mcb-* && rm -rf /tmp/mc-dist && echo "Cleaned"'
```

### 5. 启用 Redis 持久化
```bash
ssh root@8.129.133.52 'docker exec server-redis-1 redis-cli CONFIG SET appendonly yes && docker exec server-redis-1 redis-cli CONFIG SET save "60 1000"'
```

### 6. 停掉不用的 local mongod
```bash
ssh root@8.129.133.52 'systemctl stop mongod && systemctl disable mongod && echo "Local mongod stopped"'
```

## 验收标准
1. 只剩一套容器（server-api-1 + server-redis-1 + server-mongodb-1 + mediaclaw-nginx-1）
2. `curl http://localhost:3002/health` → OK
3. `curl http://localhost/health` → OK
4. `curl -so /dev/null -w "%{http_code}" http://localhost/auth` → 200
5. 容器稳定运行 30 秒无重启
6. `/tmp/` 无残留 tar 文件

## SSH 注意
- 连接不稳定，每个命令加 `-o ConnectTimeout=15 -o ServerAliveInterval=10`
- 用 `cat | ssh` 传文件
- 单个 SSH 命令尽量批量做多个事（减少连接次数）
