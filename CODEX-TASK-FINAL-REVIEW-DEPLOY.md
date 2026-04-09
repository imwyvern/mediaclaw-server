# Codex Task: PRD 查漏补缺 → 自审修复 → 生产部署

## Context
- 后端: `project/aitoearn-backend/`
- 前端: `/Users/wes/projects/mediaclaw/web/`
- PRD: `/Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v2.0.md`
- Deploy skill: `/Users/wes/projects/mediaclaw/server/.agent/skills/mediaclaw-deploy/SKILL.md`
- Build: `npx nx build aitoearn-server`
- Conventional Commits, push after each commit
- Import from `@yikart/mongodb`, `process.env['KEY']` not `.KEY`

---

## Phase 1: PRD 查漏补缺

### 1.1 读 PRD 全文
读 `/Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v2.0.md`，逐章对比代码实现。

### 1.2 检查清单（逐一验证）

**Chapter 3 — 用户角色与权限:**
- [ ] 超级管理员 / 企业管理员 / 运营人员 / 普通员工 四个角色
- [ ] 角色权限矩阵（RBAC guard）
- [ ] 邀请码注册流程

**Chapter 4 — 企业入驻:**
- [ ] 企业资料（营业执照等）
- [ ] 品牌管理 CRUD + 素材库

**Chapter 5 — 核心功能:**
- [ ] 5.1 爆款发现 + 拆解 + 素材获取
- [ ] 5.1.1 ContentRemixAgent
- [ ] 5.1.2 素材分类管理
- [ ] 5.1.3 竞品监控
- [ ] 5.1.4 管线系统（模板 + 配置 + 执行）
- [ ] 5.1.5 生产编排器（批量 + 断点续跑 + 每日调度）
- [ ] 5.1.6 去重系统
- [ ] 5.2 文案引擎（DeepSeek/Gemini + 蓝词 + 效果追踪）
- [ ] 5.2.3 Style Rewrite 引擎
- [ ] 5.3 Prompt Optimizer（失败分析 + LLM 优化 + 重试）
- [ ] 5.4 员工分发（路由 + IM 推送 + 确认回填）
- [ ] 5.5 管线匹配引擎（打分制 + 模板管理）
- [ ] 5.6 效果数据回收（video_analytics + 定时采集）
- [ ] 5.7 BYOK API Key 管理
- [ ] 5.8 微信 OAuth 登录
- [ ] 5.9 IM 分发（飞书 + 企微）
- [ ] 5.10 支付（XorPay + 套餐 + 发票）

**Chapter 6 — 数据看板:**
- [ ] 概览 dashboard
- [ ] 分析报表
- [ ] 导出功能

**Chapter 7 — 通知系统:**
- [ ] Webhook 出站
- [ ] 站内通知
- [ ] 邮件通知

**Chapter 8 — OpenClaw 集成:**
- [ ] ClawHost 实例管理
- [ ] 客户 Skill 调用接口

**Chapter 9 — API 设计:**
- [ ] RESTful 路由完整性
- [ ] 认证中间件
- [ ] 错误处理统一

### 1.3 输出
对每一项标注 ✅ 已完成 / ⚠️ 部分完成 / ❌ 缺失。
对 ⚠️ 和 ❌ 的项目立即修复实现。

---

## Phase 2: 代码自审 + 修复

### 2.1 安全审计
```bash
# 检查明文密钥
grep -rn "sk-\|api_key.*=.*['\"]" apps/aitoearn-server/src/ --include="*.ts" | grep -v spec | grep -v process.env | grep -v test
# 检查 SQL 注入风险
grep -rn "raw\|rawQuery\|\$where" apps/aitoearn-server/src/ --include="*.ts" | grep -v spec
# 检查未处理异常
grep -rn "catch.*{}" apps/aitoearn-server/src/ --include="*.ts" | grep -v spec
```

### 2.2 代码质量
```bash
# 未使用的 imports
# 空 catch blocks
# console.log 残留（应该用 Logger）
grep -rn "console\.\(log\|warn\|error\)" apps/aitoearn-server/src/core/mediaclaw/ --include="*.ts" | grep -v spec
# any 类型滥用
grep -rn ": any" apps/aitoearn-server/src/core/mediaclaw/ --include="*.ts" | grep -v spec | wc -l
```

### 2.3 架构一致性
- 所有 module 注册到 `mediaclaw.module.ts`？
- 所有 schema 导出到 barrel `libs/mongodb/src/schemas/index.ts`？
- Controller 路由无冲突？（检查重复的 path prefix）
- 环境变量统一用 `process.env['KEY']`？

### 2.4 修复
- 发现的每个问题立即修复
- 每类修复一个 commit（如 `fix(security): remove hardcoded api keys`）
- Build 必须通过

---

## Phase 3: 部署到生产服务器

读 deploy skill: `/Users/wes/projects/mediaclaw/server/.agent/skills/mediaclaw-deploy/SKILL.md`

### 3.1 准备
```bash
cd /Users/wes/projects/mediaclaw/server/project/aitoearn-backend
npx nx build aitoearn-server
```

### 3.2 构建 Docker 镜像
```bash
node scripts/build-docker.mjs aitoearn-server --context-only
cd tmp/docker-context
# 确保 colima x86build 在运行
docker context use colima-x86build
docker build --platform linux/amd64 -t mediaclaw/aitoearn-api:latest .
```

### 3.3 导出 + 上传
```bash
docker save mediaclaw/aitoearn-api:latest | gzip > /tmp/mediaclaw-api.tar.gz
rsync -avP --timeout=30 /tmp/mediaclaw-api.tar.gz root@8.129.133.52:/tmp/
```

### 3.4 远端部署
SSH 连接必须带 `-o ConnectTimeout=15 -o ServerAliveInterval=10`

```bash
ssh -o ConnectTimeout=15 -o ServerAliveInterval=10 root@8.129.133.52 << 'REMOTE'
# 备份
docker tag mediaclaw/aitoearn-api:latest mediaclaw/aitoearn-api:rollback-$(date +%Y%m%d-%H%M%S)

# 加载
docker load < /tmp/mediaclaw-api.tar.gz

# 修改 health check start_period（新镜像冷启动慢，需要 120s）
cd /opt/mediaclaw/server

# 重建
docker compose -f docker-compose.production.yml up -d --force-recreate api

# 等待更长时间（新镜像启动慢）
echo "Waiting 120s for cold start..."
sleep 120

# 健康检查
curl -sf http://localhost:3002/health && echo " API OK" || echo " API FAILED"

# 检查状态
docker inspect server-api-1 --format 'Status={{.State.Health.Status}} Restarts={{.RestartCount}} Running={{.State.Running}}'

# 如果启动成功但还在 starting，再等 60s
STATUS=$(docker inspect server-api-1 --format '{{.State.Health.Status}}')
if [ "$STATUS" = "starting" ]; then
  echo "Still starting, waiting 60 more seconds..."
  sleep 60
  curl -sf http://localhost:3002/health && echo " API OK" || echo " API FAILED"
  docker inspect server-api-1 --format 'Status={{.State.Health.Status}} Restarts={{.RestartCount}}'
fi

# 网络
docker network connect --alias api mediaclaw-net server-api-1 2>/dev/null || true
docker restart mediaclaw-nginx-1
sleep 10
curl -sf http://localhost/health && echo " Nginx OK" || echo " Nginx FAILED"

# 最终稳定性
sleep 30
RESTARTS=$(docker inspect server-api-1 --format '{{.RestartCount}}')
RUNNING=$(docker inspect server-api-1 --format '{{.State.Running}}')
echo "Final: Restarts=$RESTARTS Running=$RUNNING"

if [ "$RESTARTS" != "0" ] || [ "$RUNNING" != "true" ]; then
  echo "DEPLOY FAILED - Rolling back"
  LATEST_ROLLBACK=$(docker images mediaclaw/aitoearn-api --format '{{.Tag}}' | grep rollback | head -1)
  docker tag "mediaclaw/aitoearn-api:$LATEST_ROLLBACK" mediaclaw/aitoearn-api:latest
  docker compose -f docker-compose.production.yml up -d --force-recreate api
  sleep 60
  curl -sf http://localhost:3002/health && echo " Rollback OK"
fi
REMOTE
```

### 3.5 清理
```bash
ssh -o ConnectTimeout=15 root@8.129.133.52 'rm -f /tmp/mediaclaw-api.tar.gz'
rm -f /tmp/mediaclaw-api.tar.gz
```

### 3.6 验证
```bash
ssh -o ConnectTimeout=10 root@8.129.133.52 << 'REMOTE'
echo "=== Health ==="
curl -sf http://localhost:3002/health && echo " (API)"
curl -sf http://localhost/health && echo " (Nginx)"
echo "=== Containers ==="
docker ps --format "table {{.Names}}\t{{.Status}}" | head -6
echo "=== Disk ==="
df -h /
REMOTE
```

**Pass criteria:** API + Nginx health OK, Restarts=0, Running=true, Disk >10GB free

---

## Rules
- Phase 1 发现缺口 → 立即修复 → commit + push
- Phase 2 每类修复一个 commit
- Phase 3 严格按 deploy skill 执行
- 如果部署失败（restarts > 0），立即回滚，不要反复重试
- 部署成功后输出最终验证结果
