# MediaClaw PRD v1.5 Status

更新时间：2026-03-30

## 评审范围

- PRD：`/Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v1.5.md`
- Gap 分析：`/Users/wes/projects/mediaclaw/server/MEDIACLAW-GAP-ANALYSIS.md`
- 代码仓：`project/aitoearn-backend` + `project/aitoearn-web`

---

## 总结

基于当前代码仓审查结果，`MEDIACLAW-GAP-ANALYSIS.md` 中相当一部分“缺失项”已经被后续实现覆盖，包括但不限于：

- 多租户 `Organization + User + Role`
- API Key 认证
- 品牌资产 API
- 审批工作流 API
- 审计日志
- 文案引擎 v1（含 LLM provider 降级）
- 支付下单/二维码链路
- Skill 注册、投递、确认、反馈
- Docker / CI/CD / 部署脚本基础设施

本轮补齐并验证的重点是：

- 后端 Docker 部署链路改为“宿主机构建 dist，镜像只 COPY 运行时产物”
- AI 深度合成标识补齐为“可见水印 + 元数据标记”
- 前端 Next.js standalone + PM2 + nginx 反代部署链路
- MediaClaw 新增 API 的集成测试

---

## 本轮完成

### 1. Docker 部署补齐

- 后端 Dockerfile 改成多阶段运行时镜像，不再在容器内执行 `nx build`
- `scripts/build-docker.mjs` 会把预构建产物、`pnpm-lock.yaml`、运行时入口一并写入 docker context
- 新增 `docker-runtime.cjs`，统一处理运行时 `config.js` 注入和入口启动
- `docker-compose.production.yml` 的 `api` / `worker` 改为直接运行已构建 JS
- `scripts/deploy.sh`、nginx 配置、生产示例环境变量同步修正

### 2. PRD 5.1.1 深度合成标识

- 新增 `DeepSynthesisMarkerService`
- 输出视频强制附带：
  - 左上可见标识：`AI深度合成`
  - 右上业务水印：品牌/MediaClaw 标识
  - 元数据：`title`、`artist`、`comment`、`description`、`copyright`
- 管线执行结果会把合规标记写回 `video.metadata.compliance.aiDeepSynthesis`

### 3. 前端部署链路

- `aitoearn-web` 增加 `build:standalone`
- 新增 standalone 产物整理脚本 `scripts/prepare-standalone.sh`
- 新增服务器部署脚本 `scripts/deploy.sh`
- 新增 `ecosystem.config.cjs`，PM2 默认监听 `3001`
- 新增 nginx 配置：
  - `/api/` -> `127.0.0.1:3000`
  - `/` -> `127.0.0.1:3001`

### 4. API 可用性与测试

- 新增内容下载端点：`GET /api/v1/content/:id/download`
- 新增/补齐测试：
  - `test/e2e/mediaclaw-api.e2e-spec.ts`
  - `deep-synthesis-marker.service.spec.ts`
  - `subtitle.service.spec.ts`
- 覆盖范围包含：
  - `/api/v1/content`
  - `/api/v1/account`
  - `/api/v1/brand`
  - `/api/v1/payment`
  - `/api/v1/skill`

---

## Phase 状态

### Phase 0

已实现/已具备：

- Fork 与品牌化仓库已存在
- Docker Compose 包含 MongoDB / Redis / RustFS
- 多租户权限模型已存在
- Upstream remote 已配置，仓库历史存在 merge 记录
- OpenClaw Skill 原型已存在：`project/aitoearn-backend/libs/mediaclaw-skill`
- CI/CD 工作流已存在：
  - `.github/workflows/backend-build.yml`
  - `.github/workflows/backen-check.yml`
  - `project/aitoearn-backend/.github/workflows/deploy.yml`
  - `project/aitoearn-backend/.github/workflows/module-ci.yml`

本轮补齐：

- Docker 运行时镜像改造完成
- 前后端部署脚本链路补齐

仍剩余的真实 gap：

- 阿里云目标机上的 `docker compose up`、PM2、nginx 真实部署尚未在本轮环境执行，只能视为“部署脚本和配置已就绪”
- `project/aitoearn-backend/docker/Dockerfile.ffmpeg-base` 已存在，但主部署链路尚未显式切换到“预构建 FFmpeg Base 镜像 + 统一发布”的模式；若严格按 PRD Week 1 目标，仍需把该基础镜像纳入镜像仓库和 CI
- GitHub Actions 流水线定义齐全，但本轮没有从 GitHub 侧拿到实际 run 结果，因而“CI/CD 已跑通”只能判定为代码侧已就绪、云端执行证据待补

### Phase 1a

已实现/已具备：

- NestJS Worker + 视频管线骨架已存在
- 品牌资产 API 已存在
- OpenClaw/Skill 交付接口已存在

本轮补齐：

- AI 深度合成标识功能（PRD 5.1.1 必需项）

仍剩余的真实 gap：

- 真实第三方依赖联调证据仍缺：Gemini/Kling/OSS/生产 FFmpeg 在真实凭证下的端到端成片，本轮未做线上验证
- OpenClaw 客户端与 Gateway 的真实端到端投递/回执闭环，本轮未用外部环境复跑，只能确认仓内原型与服务端接口都已存在

### Phase 1b

已实现/已具备：

- 文案引擎 v1
- 计费/支付链路
- `MediaClaw API v1` 基础端点
- API Key 认证
- 审批工作流 API
- 操作日志
- Organization / User / Role 基础能力
- Web 前端页面基础工程已存在

本轮补齐：

- 前端 standalone 部署方案
- 新端点集成测试
- 内容下载直链能力

仍剩余的真实 gap：

- Web Dashboard 已具备部署能力，但“部署后逐页联调 MediaClaw API”本轮未在真实服务器完成 smoke test
- 如需按 PRD 严格验收“企业团队版审批 + Skill 审批交互”完成度，仍建议补一条真实审批流 E2E（创建内容 -> 提交审批 -> 多级审批 -> 发布回写）

---

## 本轮验证结果

已通过：

- `pnpm nx build aitoearn-server`
- `pnpm vitest --run --config apps/aitoearn-server/vitest.config.mts test/e2e/mediaclaw-api.e2e-spec.ts apps/aitoearn-server/src/core/mediaclaw/pipeline/deep-synthesis-marker.service.spec.ts apps/aitoearn-server/src/core/mediaclaw/pipeline/subtitle.service.spec.ts`
- `pnpm build:standalone`（在 `project/aitoearn-web`）
- `node scripts/build-docker.mjs aitoearn-server --context-only -o tmp/docker-context-verify`
- `docker build -t mediaclaw/aitoearn-api:prd-verify tmp/docker-context-verify`

需补最终证据：

- 远端阿里云部署验证

---

## 结论

从代码实现角度看，Phase 0 + Phase 1a + Phase 1b 的主体功能已基本齐备，`MEDIACLAW-GAP-ANALYSIS.md` 里的很多条目已经不再是“未实现”，而是“缺少真实环境部署或端到端验证证据”。

本轮真正新补齐的关键差距是：

- Docker 运行时镜像链路
- PRD 5.1.1 深度合成标识
- 前端可部署形态
- 新 API 集成测试

剩余需要优先推进的不是继续堆模块，而是：

1. 跑通一次真实阿里云部署
2. 固化 FFmpeg Base 镜像发布链路
3. 补真实 Skill / 审批 / 成片的端到端验收证据
