# Codex Task: 后端各模块对齐 PRD — 接入真实数据接口

## 目标
当前后端 services 和 controllers 已搭好骨架，但大量返回 stub/mock 数据。
需要逐模块对齐 PRD，把 stub 返回改为真实 MongoDB 查询 + 真实外部 API 调用。

**原则**：
- 每个模块一个 commit，Conventional Commits 格式
- 不改已经能用的 auth、payment（xorpay）逻辑
- 外部 API（TikHub、VCE Gemini 等）在环境变量缺失时 graceful fallback，不 crash
- 提交前确保 `npx nx build aitoearn-server` 通过
- 不改 `tikhub.service.ts` 的 API 调用逻辑，只改消费它的 service 层

## 模块清单

### 1. data-dashboard（数据看板）— 当前有 1 处 stub
文件: `apps/aitoearn-server/src/core/mediaclaw/data-dashboard/data-dashboard.service.ts`
- PRD §5.4.2: 四档看板（基础/标准/高级/全量）
- 当前问题：`source: 'stub'` 返回假数据
- 改为：从 `video_analytics` collection 聚合查询真实播放量/点赞/评论/分享
- 按组织的订阅档位决定返回哪些字段
- 内容健康度指标（低播放比例、互动率异常、首日衰减率）用 MongoDB aggregation 计算

### 2. discovery/content-remix（爆款拆解）— 9 处 stub
文件: `apps/aitoearn-server/src/core/mediaclaw/discovery/content-remix.service.ts`
- PRD §5.7.2.1: ContentRemixAgent 驱动的爆款拆解
- 当前问题：AI 分析调用全部 fallback 到 stub（VCE_GEMINI_API_KEY 缺失时）
- 改为：
  - 读取环境变量 `VCE_GEMINI_API_KEY`，有则调 `https://api.vectorengine.cn/v1/chat/completions`（model: `gemini-3.1-pro-preview`）
  - 无 key 时保留当前 stub fallback，但在 response 中标记 `source: 'fallback'`
  - AI prompt 要覆盖：视频结构拆解、文案风格分析、标签策略、最佳发布时间建议

### 3. analytics（效果追踪）
文件: `apps/aitoearn-server/src/core/mediaclaw/analytics/analytics.controller.ts`
- PRD §5.4.3: 效果数据飞轮
- 当前 controller 只有 35 行骨架
- 改为：
  - GET /analytics/overview — 从 video_analytics collection 聚合最近 7/30 天数据
  - GET /analytics/video/:videoId — 单条视频 T+1~T+90 历史趋势
  - GET /analytics/benchmark — 行业 benchmark（按 industry 聚合所有客户匿名数据）
  - POST /analytics/refresh — 触发 TikHub API 批量刷新效果数据（调用 tikhub.service 已有方法）

### 4. pipeline + brand-edit + video-gen（管线引擎）— 4 处 mock
文件:
- `pipeline/brand-edit.service.ts` (2 处 mock)
- `pipeline/video-gen.service.ts` (2 处 mock)
- PRD §5.1.1: 模板化管线体系
- 当前问题：API key 缺失时降级为 mock 模式，但 mock 返回结构不符合 PRD schema
- 改为：
  - brand-edit: 读 `VCE_GEMINI_API_KEY` 调 VCE Gemini 做品牌帧编辑，无 key 时返回 `{ status: 'skipped', reason: 'no_api_key' }`
  - video-gen: 读 `KLING_API_KEY`（base URL `https://api.vectorengine.ai`）调 Kling V3 生成视频
  - 管线编排器（pipeline.service）确保步骤串联：brand-edit → video-gen → copy → subtitle

### 5. usage/billing（扣费+账单）
文件:
- `usage/usage.service.ts` (FIFO 扣费已实现 ✅)
- `usage/usage.controller.ts`
- `billing/billing.controller.ts`
- PRD §3.1-3.4 + §5.8
- FIFO 扣费逻辑已实现且 review 通过，**不要改 chargeVideo 方法**
- 补充：
  - GET /usage/summary — 当前周期内各包余额汇总（从 video_packs collection 查）
  - GET /usage/history — 扣费历史分页查询
  - GET /billing/invoices — 企业版月账单列表
  - POST /billing/export — 导出账单 CSV

### 6. task-mgmt（任务管理）
文件: `task-mgmt/task-mgmt.service.ts` (151 行)
- PRD §5.1.7: 生产编排器
- 确保任务创建时写入 production_batches collection
- 任务状态流转：draft → queued → processing → review → approved → delivered
- 每次状态变更写 iteration_log

### 7. distribution（员工分发）
文件: `distribution/distribution.controller.ts` (155 行)
- PRD §5.1.5: 员工分发路由系统
- 确保：
  - POST /distribution/assign — 按 employee_assignments 规则分配视频给员工
  - POST /distribution/publish-confirm — 员工回传「已发布」+ 平台链接
  - GET /distribution/status — 查分发状态（待分配/已分配/已发布/已追踪）

### 8. notification（通知）
文件: `notification/notification.controller.ts` (57 行)
- PRD: 爆款预警 + 任务完成通知 + 审核通知
- 当前：已有 webhook + email service
- 补充：
  - 确保 discovery 新爆款时调 notification.service 推送
  - 确保 task-mgmt 状态变更时推送
  - GET /notification/list — 用户通知列表（从 discovery_notifications + task notifications 合并）

### 9. settings/BYOK
文件: `settings/settings.controller.ts` + `settings/byok.service.ts`
- PRD §5.8.2: BYOK 配置流程
- 确保：
  - POST /settings/apikeys — 保存客户自有 API key（加密存储）
  - BYOK key 优先于平台 key 使用（在 pipeline service 里读取）
  - GET /settings/apikeys — 返回脱敏 key 列表（只显示最后 4 位）

### 10. clawhost — 保持 stub
文件: `clawhost/clawhost.service.ts`
- 这个依赖 K8s 基础设施，V1.0 不实现
- **不要改这个文件**，保持现状

## 注意
- MongoDB schemas 在 `libs/mongodb/src/schemas/` 下，已有 video-task、organization、viral_contents 等
- 如果需要新 collection，在 schema 目录新建并注册到 module
- 所有 API 返回统一包装：`{ success: boolean, data: T, error?: string }`
- 环境变量引用通过 `ConfigService` 注入，不直接 `process.env`
