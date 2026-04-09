# Codex Task: 推进 PRD 实现到 100%（剩余缺口全部补齐）

## Context
Working dir: `project/aitoearn-backend/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.
Conventional Commits. 先定位再改，不要跳过调查直接写。

## 目标
把所有 PRD 要求但还未实现/还是 stub 的功能全部补齐，达到"无 stub、无 TODO、无 mock 假数据"状态。

---

## Phase A: 消灭所有 Stub/TODO（19 处）

### A1: analytics — TikHub 数据采集真实化
文件: `analytics/analytics-collector.service.ts`, `analytics/analytics.service.ts`
- 把 `runDailyCollection()` 中的模拟数据替换为真实 HTTP 调用框架
- 使用 `@nestjs/axios` 或 `node-fetch` 调 TikHub/MediaCrawler API
- 如果 API 不可用（TikHub 已标记 unavailable），保留 graceful fallback：返回 `{ source: 'unavailable', metrics: null }` 而不是假数据
- 删除所有 `Math.random()` 模拟逻辑
- 7 个 TODO 全部处理

### A2: production — 管线执行真实化
文件: `production/production-orchestrator.service.ts`
- 当前 `startBatch` 用 setTimeout + random success/fail 模拟
- 替换为调用 `video.service.ts` 的 `createVideoTask()` + `pipeline-system.service.ts` 的管线执行
- 把 4 个 TODO 替换为真实调用链：createVideoTask → enqueue to BullMQ → worker processes
- 如果管线执行部分还不完整，调用现有 `video-gen.service.ts` 的真实 Kling API 路径

### A3: clawhost — K8s Pod 创建
文件: `clawhost/clawhost.service.ts`
- `stubCreateK8sPod` → 替换为 Docker API 调用（早期方案）
- 使用 `dockerode` 或 shell exec `docker run` 来创建容器
- 如果 docker 不在同机器，改为 SSH 远程命令
- 最低限度：把 stub 改为"记录实例信息到 DB + 标记 pending_manual_setup"，删除假 stub
- 3 个 TODO 处理

### A4: video-gen — 补齐 mock 路径
文件: `pipeline/video-gen.service.ts`
- 检查 3 个 mock/stub 点，确保 Kling V3 API 调用路径完整
- VCE API: `https://api.vectorengine.ai/kling/v1/videos/omni-video`
- 确保 API key 从 BYOK 或环境变量获取（调用 `byok.service.ts` 的 `resolveApiKey`）

### A5: copy-strategy — LLM 策略更新接入
文件: `copy/copy-strategy.service.ts`
- 把 TODO 替换为：读取 top patterns → 构造 system prompt 附加段 → 传给 copy-engine 的 LLM 调用
- 不需要独立 LLM 调用，只需把 insights 注入已有的 DeepSeek/Gemini prompt

### A6: pipeline-match — 参考视频分析
文件: `pipeline-match/pipeline-match.service.ts`
- `analyzeReferenceVideo` 的 stub → 调用 ContentRemixAgent（discovery/content-remix.service.ts）
- 如果 ContentRemix 也是 stub，则用 Gemini Vision API 做视频帧分析
- 最低限度：返回结构化的空分析 + 标记 `analysis_source: 'pending_manual'`

### A7: prompt-optimizer — LLM 优化
文件: `prompt-optimizer/prompt-optimizer.service.ts`
- heuristic 规则 → 增加 LLM 调用路径（DeepSeek/Gemini）
- 输入: 原始 prompt + 失败原因 + 质量评分 → LLM 输出优化后的 prompt
- 保留 heuristic 作为 fallback（LLM 不可用时）

### A8: acquisition — TikHub 状态
文件: `acquisition/tikhub.service.ts`
- 当前标记 unavailable —— 如果确实不可用，改为清晰的错误消息而非 TODO
- 如果有替代数据源（MediaCrawler），添加 fallback 路径

---

## Phase B: 缺失大模块

### B1: Style Rewrite 引擎
PRD 5.2.3: 风格改写 — 同一内容适配不同平台风格

创建 `apps/aitoearn-server/src/core/mediaclaw/copy/style-rewrite.service.ts`:
- `rewriteForPlatform(copyText, fromPlatform, toPlatform)` — 改写文案适配目标平台
  - 抖音: 强 hook 开头 + 节奏快 + emoji 密集
  - 小红书: 种草语气 + 分段 + 标签多
  - 快手: 接地气 + 口语化
- `rewriteWithStyle(copyText, styleGuide)` — 按品牌风格指南改写
- 使用已有的 DeepSeek/Gemini fallback 调用
- 注册到 copy module

Controller 路由:
- `POST /api/v1/copy/rewrite-style` — body: { text, fromPlatform, toPlatform, styleGuide? }

### B2: 定时每日生产调度
PRD 5.1.7: 生产编排器每日自动跑

在 `production/production-orchestrator.service.ts` 添加:
- `@Cron('0 2 * * *')` — 每天凌晨 2 点自动检查
- `scheduleDailyProduction(orgId)` — 检查管线配置 → 自动创建 batch → 启动
- 从 org 的 pipeline 配置读取：每日目标条数、使用的模板、品牌参数
- 记录调度日志

### B3: 向量查重（简化版，不用 Milvus）
PRD 5.1.6: 三阶段去重 — Phase 1 先做 rule-based + 文本 hash

创建 `apps/aitoearn-server/src/core/mediaclaw/dedup/` module:
- `dedup.service.ts`:
  - `checkDuplicate(orgId, content)` — 文本 hash 去重（MD5/SHA256）
  - `registerContent(orgId, content, videoTaskId)` — 注册已生产内容
  - `getDeduplicationStats(orgId)` — 去重统计
- Schema: `content-hash.schema.ts` — { orgId, hash, videoTaskId, contentType, createdAt }
- 在 video 生产前调用 checkDuplicate
- TODO 注释标明 Phase 2 升级为 Milvus 向量
- Controller: `POST /api/v1/dedup/check`, `GET /api/v1/dedup/stats`

---

## Phase C: 前端真实数据对接（关键 3 页面）

⚠️ 前端代码在 `/Users/wes/projects/mediaclaw/web/src/`

### C1: Dashboard 首页
文件: `app/dashboard/page.tsx`
- 把 mock 数据替换为 API 调用: `GET /api/v1/data/overview`, `GET /api/v1/analytics/overview`
- 使用 `fetch` + SWR 或 useEffect
- 添加 loading skeleton + error state

### C2: Videos 页面
文件: `app/dashboard/videos/page.tsx`
- 对接 `GET /api/v1/videos` (list), `GET /api/v1/video/:id` (detail)
- 视频列表 + 状态筛选 + 分页

### C3: Billing 页面
文件: `app/dashboard/billing/page.tsx`, `billing/checkout/page.tsx`
- 对接 `GET /api/v1/billing/usage-summary`, `GET /api/v1/payment/products`
- checkout: 调用 `POST /api/v1/payment/create` → 打开 XorPay 收银台 URL
- 删除 setTimeout 模拟

---

## Phase D: 自检

完成以上所有后:

1. `grep -rn "TODO\|FIXME\|stub\|mock\|placeholder\|not.*implement" apps/aitoearn-server/src/core/mediaclaw/ --include="*.ts" | grep -v spec | grep -v node_modules`
   — 必须为空（0 结果）

2. `npx nx build aitoearn-server` — 必须通过

3. 跑一次完整 grep，确认无 stub:
   ```bash
   echo "=== Remaining stubs ==="
   grep -rn "stub\|TODO\|FIXME" apps/aitoearn-server/src/core/mediaclaw/ --include="*.ts" -l | grep -v spec
   echo "=== Build ==="
   npx nx build aitoearn-server
   ```

4. 如果发现任何遗漏，立即修复。

5. 最后 commit message: `feat(mediaclaw): achieve 100% PRD implementation coverage`

## Rules
- 每个 Phase 完成后 build + push
- Phase A 每个 sub-task 一个 commit
- Phase B 每个模块一个 commit
- Phase C 每个页面一个 commit
- Phase D 自检如果有修复，额外 commit
- Conventional Commits
- 不要跳步，按顺序执行
