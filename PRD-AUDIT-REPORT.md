# MediaClaw PRD 对码审计报告

## 1. 审计范围

- 任务说明:`/Users/wes/projects/mediaclaw/server/CODEX-TASK-PRD-AUDIT.md`
- PRD:`/Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v2.0.md`
- 后端:`apps/aitoearn-server/src/core/mediaclaw/`
- 共享库:`libs/`,重点核对 `libs/mongodb/src/schemas/`
- 前端:`/Users/wes/projects/mediaclaw/web/src/`

本次为只读静态审计。未安装依赖、未构建、未运行迁移、未修改任何业务代码;唯一新增产物为本报告。

## 2. 审计方法与判定标准

- 逐章提取 PRD 需求点,对照 controller、service、module、schema、前端 page/API 接线。
- 重点核对是否存在完整逻辑、API 暴露、module 注册、前端接线、真实持久化模型。
- `✅ 已实现`:完整逻辑存在,API 已暴露,无明显 TODO/stub/mock 依赖。
- `⚠️ 部分实现`:有主干代码,但存在 stub/TODO/mock、关键字段缺失、链路未闭环、前后端契约不一致,或仅覆盖部分 PRD 要求。
- `❌ 未实现`:未发现对应模块/模型/接口,或 PRD 要求的关键能力完全缺位。
- `◐ 间接支撑(非代码章节)`:愿景、GTM、路线图、成功指标等非直接代码交付物,仅可由现有代码间接支撑,不纳入三态统计。

## 3. 总览统计

说明:以下统计仅覆盖"可直接落到代码的功能点"。第 1/2/3/8/9/10/11/12 章以"间接支撑/非代码章节"单列说明,不纳入三态统计。

| 指标 | 数量 |
| --- | ---: |
| 可代码验证功能点 | 33 |
| ✅ 已实现 | 4 |
| ⚠️ 部分实现 | 23 |
| ❌ 未实现 | 6 |

总体判断:

- 后端模块化骨架已经成型,认证、支付、内容审批、API Key、Webhook、审计、基础分析等能力真实存在。
- PRD v2.0 强调的矩阵化能力仍缺关键中枢:`account_routing`、`production_batches`、`content_dedup`/Milvus、`video_analytics` 时序表、Prompt Optimizer、迭代日志均未真正落地。
- 前端大量页面仍停留在 mock/fallback 阶段,尤其是支付、自助开通、设置中心、看板与视频创建页,导致"后端已有能力"没有形成稳定的用户闭环。

## 4. 按章节审计

### 第 1 章 愿景与定位

结论:本章属于产品定位与战略表达,不是直接代码交付物;现有代码对"生产-分发-分析"闭环形成了基础支撑,但距离 PRD 所述的一体化平台仍有明显差距。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| AI 驱动短视频生产平台定位 | ◐ 间接支撑 | `apps/aitoearn-server/src/app.module.ts:21-65`;`apps/aitoearn-server/src/core/mediaclaw/mediaclaw.module.ts:93-155` | 模块装配完整,说明平台骨架已存在;但"统一工作台/生态定位"本身不是单个代码交付件。 |
| "生产-分发-分析"闭环定位 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/video/video.service.ts:48-219`;`apps/aitoearn-server/src/core/mediaclaw/distribution/distribution.service.ts:149-329`;`apps/aitoearn-server/src/core/mediaclaw/analytics/analytics.service.ts:15-320` | 三段链路均有代码,但分发推送、效果时序表、全量数据飞轮仍不完整。 |

### 第 2 章 用户画像与场景

结论:代码已体现"个人体验版 + 企业版"双形态,但管线群、员工发布、企业管理后台等场景在前端侧仍大量依赖 mock。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 个人体验版与企业版双形态用户 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/auth/auth.service.ts:69-113`;`apps/aitoearn-server/src/core/mediaclaw/auth/enterprise-auth.service.ts:55-249`;`libs/mongodb/src/schemas/mediaclaw-user.schema.ts:45-91` | 已有个人 trial pack、企业组织、成员邀请与组织切换。 |
| 群内协作、员工发布、管理者看板场景 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/distribution/distribution.service.ts:149-329`;`/Users/wes/projects/mediaclaw/web/src/app/dashboard/page.tsx:22-30`;`/Users/wes/projects/mediaclaw/web/src/app/dashboard/videos/[id]/page.tsx:41-58` | 后端有分发与已发布回调,但前端看板、视频详情仍有大量 fallback mock。 |

### 第 3 章 商业模式

结论:个人按包、企业订阅、API 化商业化方向在代码中都能找到支撑点,但 BYOK 与完整自助服务尚未闭环。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 个人按包付费 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/auth/auth.service.ts:104-112`;`libs/mongodb/src/schemas/video-pack.schema.ts:23-60`;`apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service.ts:357-385` | 个人 trial pack、条数包发放、支付回调后发包已存在。 |
| 企业订阅 + 配额/后付费/BYOK | ◐ 间接支撑 | `libs/mongodb/src/schemas/subscription.schema.ts:24-67`;`libs/mongodb/src/schemas/organization.schema.ts:26-63`;`apps/aitoearn-server/src/core/mediaclaw/usage/usage.service.ts:34-218` | 有订阅、billingMode、配额统计;但 BYOK 实际挂载在 subscription 单字段,不符合 PRD 的 organization.apiKeys 设计。 |
| API 化对外商业化能力 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/apikey/apikey.service.ts:20-115`;`apps/aitoearn-server/src/core/mediaclaw/webhook/webhook.service.ts:22-177` | API Key、Webhook、Usage 已可支撑 B2B API 化方向。 |

### 第 4 章 系统架构

结论:代码骨架已落地,但"矩阵化生产 + OpenClaw 主入口 + 自动开通"仍停留在半成品状态。

代码可验证点:4 项,其中 `✅ 2 / ⚠️ 2 / ❌ 0`。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 模块化领域拆分与装配 | ✅ 已实现 | `apps/aitoearn-server/src/app.module.ts:21-65`;`apps/aitoearn-server/src/core/mediaclaw/mediaclaw.module.ts:93-155` | `MediaClawModule` 已被主应用接入,schema 与子模块注册齐全,模块边界清晰。 |
| API 暴露与模块注册 | ✅ 已实现 | `apps/aitoearn-server/src/core/mediaclaw/video/video.controller.ts:11-20`;`apps/aitoearn-server/src/core/mediaclaw/acquisition/acquisition.controller.ts:9-34`;`apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.controller.ts:28-116` | 多数核心域已暴露 `/api/v1/*` 路由,且与前端 `NEXT_PUBLIC_API_URL + /v1/*` 约定基本一致。 |
| 队列化生产流与异步任务 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/video/video.service.ts:48-112`;`apps/aitoearn-server/src/core/mediaclaw/video/video.service.ts:170-219`;`apps/aitoearn-server/src/core/mediaclaw/pipeline-system/pipeline-system.service.ts:275-329` | 已有任务入队、状态更新、失败退 credits、warm-up 任务;但没有 PRD 要求的 batch 编排器和断点续跑。 |
| OpenClaw / ClawHost 接入层 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/skill/skill.service.ts:32-207`;`apps/aitoearn-server/src/core/mediaclaw/clawhost/clawhost.service.ts:37-90`;`apps/aitoearn-server/src/core/mediaclaw/clawhost/clawhost.service.ts:308-320`;`apps/aitoearn-server/src/core/mediaclaw/clawhost/clawhost.service.ts:457-464` | Skill 注册/配置/回执已有接口,但 Pod 创建和日志获取仍是 stub,无法支撑 PRD 的自动开通架构。 |

### 第 5 章 功能模块详述

结论:本章是 PRD 与代码差距最大的部分。基础生产、支付、审批、Webhook 等已落地,但矩阵账号路由、批量编排、向量查重、Prompt 返工、迭代日志、自助交付闭环均不完整。

代码可验证点:18 项,其中 `✅ 0 / ⚠️ 15 / ❌ 3`。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 5.1.1 模板化生产管线 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/pipeline-system/pipeline-system.service.ts:84-219`;`apps/aitoearn-server/src/core/mediaclaw/pipeline/pipeline.service.ts:38-182`;`/Users/wes/projects/mediaclaw/web/src/app/dashboard/videos/create/page.tsx:74-79` | 已有模板 CRUD、应用模板、管线 CRUD;但前端创建视频页提交的 payload 与 `video.controller.ts:11-20` 需要的 `taskType/sourceVideoUrl` 不匹配,批量生产契约未闭环。 |
| 5.1.4 Style Rewrite / 后处理策略 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/pipeline/pipeline.service.ts:38-182` | 有品牌编辑、渲染、字幕、去重后处理和质量检查策略,但没有独立的 Style Rewrite 引擎和多轮返工。 |
| 5.1.5 员工分发路由系统 | ❌ 未实现 | `apps/aitoearn-server/src/core/mediaclaw/platform-account/platform-account.service.ts:31-111`;`apps/aitoearn-server/src/core/mediaclaw/distribution/distribution.service.ts:149-329` | **PRD v2.0 重构**:改为 OpenClaw Bot → 飞书推送 → 员工手动发布。未发现 `employee_assignments` schema、飞书推送逻辑、员工确认回填。比原 `account_routing` 方案大幅简化。 |
| 5.1.6 向量查重系统 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/pipeline/pipeline.service.ts:38-182` | 仅看到 rule-based dedup/post-process;未发现 Milvus `content_dedup`、三阶段流水线、批量查重汇总。 |
| 5.1.7 生产编排器 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/video/video.service.ts:48-112`;`apps/aitoearn-server/src/core/mediaclaw/pipeline-system/pipeline-system.service.ts:275-329` | 能创建单任务并 warm-up 3 个任务,但没有 `production_batches`、`batch_id`、断点续跑、整批统计与 IM 汇总通知。 |
| 5.1.8 Prompt Optimizer 智能返工引擎 | ❌ 未实现 | `apps/aitoearn-server/src/core/mediaclaw/content-mgmt/content-mgmt.service.ts:153-279`;仓库搜索未发现 `prompt_fixes` / `needs_manual_review` | 当前只有审批与评论,没有"失败原因结构化分析 -> 生成优化 prompt -> 只重跑失败环节"的实现。 |
| 5.1.9 生产迭代日志系统 | ❌ 未实现 | `libs/mongodb/src/schemas/video-task.schema.ts:145-192`;`apps/aitoearn-server/src/core/mediaclaw/content-mgmt/content-mgmt.service.ts:72-377` | `VideoTask` 只覆盖任务状态和审批字段,未发现 `iteration_log_{video}` / `batch_log_{batch}` 的持久化模型。 |
| 5.2 智能文案引擎 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/copy/copy-engine.service.ts:64-317`;`apps/aitoearn-server/src/core/mediaclaw/copy/copy.controller.ts:5-45` | 已有 DeepSeek/Gemini/heuristic fallback、历史去重、品牌关键词、蓝词和评论引导;但没有完整"效果回收 -> prompt 策略更新"的持久化闭环,也缺统一 `generateCopy` HTTP 入口。 |
| 5.3 内容分发引擎 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/distribution/distribution.service.ts:70-329`;`apps/aitoearn-server/src/core/mediaclaw/content-mgmt/content-mgmt.service.ts:282-377` | 分发规则、推送记录、已发布回填和反馈收集存在;但真实 IM session 分发与通知仍是 stub/log 级。 |
| 5.3.5 管线管理模块 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/pipeline/pipeline.service.ts:38-182`;`apps/aitoearn-server/src/core/mediaclaw/pipeline-system/pipeline-system.service.ts:221-329` | 支持 create/update/archive/template/pre-warm/偏好学习;未看到与 OpenClaw 群会话的完整"群内下单 -> 群内预览 -> 分发确认"闭环。 |
| 5.4 全域数据中台 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/analytics/analytics.service.ts:15-320`;`apps/aitoearn-server/src/core/mediaclaw/data-dashboard/data-dashboard.service.ts:29-213`;`apps/aitoearn-server/src/core/mediaclaw/report/report.service.ts:50-278`;`/Users/wes/projects/mediaclaw/web/src/app/dashboard/analytics/page.tsx:37-53` | 概览、趋势、报告、导出已存在;但 `topVideos` 前端仍是 mock,benchmark 为 stub,且未采用 PRD 的 `video_analytics` 独立时序表。 |
| 5.5 AI Agent | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/skill/skill.service.ts:32-207`;`apps/aitoearn-server/src/core/mediaclaw/skill/skill.controller.ts:7-60` | 已有 agent 注册、配置、反馈、交付确认;没有 PRD 所述多 Agent 协作图谱与跨 Skill 联动执行。 |
| 5.6 OpenClaw 服务接入 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/skill/skill.service.ts:32-207`;`apps/aitoearn-server/src/core/mediaclaw/clawhost/clawhost.service.ts:37-464`;`apps/aitoearn-server/src/core/mediaclaw/platform-account/platform-account.service.ts:126-161` | Skill/API 面向 OpenClaw 的接口存在,但 Gateway 推送、heartbeat 兜底、自动装配 Pod、多 Skill 协作都未闭环。 |
| 5.7 爆款追踪与预测 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/discovery/discovery.service.ts:95-221`;`apps/aitoearn-server/src/core/mediaclaw/discovery/content-remix.service.ts:32-124`;`apps/aitoearn-server/src/core/mediaclaw/acquisition/tikhub.service.ts:79-217`;`apps/aitoearn-server/src/core/mediaclaw/competitor/competitor.service.ts:19-133` | 已有 recommendation pool、viral score、remix brief、竞品热门内容;但多个路径在无 key 时直接 stub,缺少稳定预测模型与完整效果追踪飞轮。 |
| 5.8 客户管理与计费 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/auth/enterprise-auth.service.ts:55-249`;`apps/aitoearn-server/src/core/mediaclaw/apikey/apikey.service.ts:20-115`;`apps/aitoearn-server/src/core/mediaclaw/usage/usage.service.ts:34-218`;`apps/aitoearn-server/src/core/mediaclaw/webhook/webhook.service.ts:22-177`;`apps/aitoearn-server/src/core/mediaclaw/notification/notification.service.ts:26-160` | 多组织、API Key、Webhook、Quota/Rate Limit 已有;但 BYOK 未按 org 维度完整建模,通知实际发送仍是日志级实现,设置页 API Keys/Webhooks/Notifications 仍是静态 UI。 |
| 5.9 ToB 企业功能 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/content-mgmt/content-mgmt.service.ts:72-377`;`apps/aitoearn-server/src/core/mediaclaw/auth/enterprise-auth.service.ts:55-249`;`apps/aitoearn-server/src/core/mediaclaw/audit/audit.service.ts:39-124` | 审批流、多级 review、邀请成员和审计查询都存在,甚至超前于 PRD V1.0;但 SSO、内容日历、批量操作、月度 PDF 导出、企业管理前台大多未完。 |
| 5.10 支付系统 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.controller.ts:28-116`;`apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service.ts:88-385`;`/Users/wes/projects/mediaclaw/web/src/app/dashboard/billing/page.tsx:30`;`/Users/wes/projects/mediaclaw/web/src/app/dashboard/billing/checkout/page.tsx:48-63` | 后端订单、签名验签、幂等回调、过期取消基本完整;但无 `XORPAY_API_URL` 时回退 mock `payUrl`,前端支付页仍是 `setTimeout` 模拟成功。 |
| 5.11 客户注册与自助入口 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/auth/auth.service.ts:31-125`;`apps/aitoearn-server/src/core/mediaclaw/auth/enterprise-auth.service.ts:55-249`;`/Users/wes/projects/mediaclaw/web/src/app/auth/page.tsx:74-163`;`/Users/wes/projects/mediaclaw/web/src/app/dashboard/onboarding/page.tsx:184` | 短信验证码登录、企业注册、trial pack 已落地;微信 OAuth 未实现,自助 onboarding 与欢迎流大多仍是 mock。 |

### 第 6 章 技术选型与基建

结论:NestJS + MongoDB + 定时任务 + 加密/签名等基础选型已落地,但部署、观测、容灾基建远未达到 PRD 的生产要求。

代码可验证点:4 项,其中 `✅ 1 / ⚠️ 2 / ❌ 1`。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 技术栈与基础框架落地 | ✅ 已实现 | `apps/aitoearn-server/src/app.module.ts:21-65`;`apps/aitoearn-server/src/core/mediaclaw/mediaclaw.module.ts:93-155`;`apps/aitoearn-server/src/main.ts:6-13` | NestJS 模块化、Mongoose schema、主应用装配、CORS/静态资源等基础框架已成型。 |
| 队列、Cron、安全基建 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/video/video.service.ts:48-112`;`apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service.ts:281-301`;`apps/aitoearn-server/src/core/mediaclaw/webhook/webhook.service.ts:105-177`;`apps/aitoearn-server/src/core/mediaclaw/platform-account/platform-account.service.ts:31-77` | 有任务入队、订单过期扫描、Webhook HMAC、平台账号 AES-256 存储;但速率控制、幂等、告警策略还不系统。 |
| 部署与运行时基建 | ⚠️ 部分实现 | `apps/aitoearn-server/src/core/mediaclaw/clawhost/clawhost.service.ts:37-464` | 有实例模型、安装 Skill、批量升级和健康扫描;但核心 Pod 创建、日志拉取是 stub,离自动化部署还有明显距离。 |
| 监控、告警、备份、容灾 | ❌ 未实现 | `apps/aitoearn-server/src/core/mediaclaw/clawhost/clawhost.service.ts:236-320` | 仅看到基础健康扫描和 stub 日志;未发现独立 observability、备份、恢复、告警聚合模块。 |

### 第 7 章 数据模型

结论:当前 schema 更像"V1.0/V1.5 的务实实现",并未完整跟上 PRD v2.0 的数据模型扩展。为避免与 5.8/5.10 重复统计,本章表格聚焦差异最大的核心 collection;`subscriptions`、`video_packs`、`payment_orders` 已存在,分别见 `subscription.schema.ts:24-67`、`video-pack.schema.ts:23-60`、`payment-order.schema.ts:32-92`。

代码可验证点:7 项,其中 `✅ 1 / ⚠️ 4 / ❌ 2`。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| `users` + `organizations` 多租户身份模型 | ⚠️ 部分实现 | `libs/mongodb/src/schemas/mediaclaw-user.schema.ts:45-91`;`libs/mongodb/src/schemas/organization.schema.ts:26-63` | 有 `orgId`、`role`、`imBindings`、`billingMode`、配额字段;但 `organizations` 缺 PRD 的 `planId/apiKeys/videoCredits/defaultPlatforms/timezone` 完整结构,`users` 也未包含 PRD 的 `passwordHash/status` 形态。 |
| `brands` | ✅ 已实现 | `libs/mongodb/src/schemas/brand.schema.ts:43-68` | `assets`、`videoStyle`、`orgId`、唯一索引与 PRD 定义较接近,是当前最接近 PRD 的 collection。 |
| `videos`(现实现为 `video_tasks`) | ⚠️ 部分实现 | `libs/mongodb/src/schemas/video-task.schema.ts:128-196`;`apps/aitoearn-server/src/core/mediaclaw/video/video.service.ts:48-219` | 实际持久化核心是 `video_tasks`,含状态、metadata、approval;与 PRD 的 `videos` 聚合文档不一致,尤其缺 `source/output/copy/dedup/discoveryPerformance/error_log/analytics_snapshot` 完整结构。 |
| `campaigns` | ⚠️ 部分实现 | `libs/mongodb/src/schemas/campaign.schema.ts:26-72` | 有 `status/schedule/targetPlatforms/统计字段`,但缺 PRD 的 `phases/quotaBudget/quotaUsed/analytics.roi/createdBy` 结构。 |
| `audit_logs` | ⚠️ 部分实现 | `libs/mongodb/src/schemas/audit-log.schema.ts:7-40`;`apps/aitoearn-server/src/core/mediaclaw/audit/audit.service.ts:39-124` | TTL 90 天和筛选查询已实现;但 PRD 要求的企业版导出 CSV/JSON 与更丰富 `target/meta` 结构未落地。 |
| `video_analytics` | ❌ 未实现 | `apps/aitoearn-server/src/core/mediaclaw/analytics/analytics.service.ts:15-320` | 当前分析直接从 `VideoTask.metadata` 聚合,未发现独立 `video_analytics` collection、`recordedAt` 时序索引和 T+1~T+90 采集策略持久化。 |
| `delivery_records` / `employee_assignments` / `production_batches` / `content_dedup` | ❌ 未实现 | `apps/aitoearn-server/src/core/mediaclaw/distribution/distribution.service.ts:149-329`;仓库未发现对应 schema | 部分字段被塞进 `VideoTask.metadata.distribution.*`,但 PRD 所需独立 collection 全部缺位。`employee_assignments` 为 v2.0 重构后的员工分发路由(替代原 `account_routing`)。 |

### 第 8 章 开发路线图

结论:本章是项目计划,不是直接代码交付物。代码现状更接近"部分已越过 V1.5,部分仍停留在 V1.0/V1.5 之间"的混合状态。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 路线图与 Sprint 拆分 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/content-mgmt/content-mgmt.service.ts:72-377`;`apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service.ts:88-385` | 审批流与支付实现说明部分能力已提前;但账号路由、生产编排器、OpenClaw 自动化仍未到 PRD 节奏。 |

### 第 9 章 成功指标

结论:代码中已有部分指标采集与报告能力,但 PRD 所需的平台化成功指标并不能仅由代码直接证明。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 平台成功指标与经营指标 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/analytics/analytics.service.ts:15-320`;`apps/aitoearn-server/src/core/mediaclaw/report/report.service.ts:175-278` | 只能间接支撑内容层面的 views/likes/comments/trends/report;无法证明商业化指标、留存、GTM 成效。 |

### 第 10 章 GTM

结论:本章属于市场与销售策略,代码只能提供有限支撑,例如体验版、企业注册、支付、自助 API。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 销售驱动体验版与企业转化漏斗 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/auth/auth.service.ts:69-113`;`apps/aitoearn-server/src/core/mediaclaw/auth/enterprise-auth.service.ts:55-111`;`apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service.ts:88-385` | 代码能支撑试用、注册、购买,但 GTM 本身不是代码交付物。 |

### 第 11 章 风险与对策

结论:代码中已有部分风险控制措施,如支付幂等、Webhook 签名、审计 TTL、基础健康检查;但稳定性、容灾与法务/合规流程仍主要停留在 PRD 层。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 支付、回调、安全与审计控制 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service.ts:157-213`;`apps/aitoearn-server/src/core/mediaclaw/webhook/webhook.service.ts:105-177`;`libs/mongodb/src/schemas/audit-log.schema.ts:37-40` | 已有签名验签、幂等、TTL、HMAC;但备份、容灾、合规删除请求、法务审查流程没有代码闭环。 |

### 第 12 章 附录

结论:本章主要是参考资料、接口说明和补充设计。代码只能局部呼应。

| 功能点 | 状态 | 对应代码 | 备注 |
| --- | --- | --- | --- |
| 外部依赖与接口附录 | ◐ 间接支撑 | `apps/aitoearn-server/src/core/mediaclaw/acquisition/tikhub.service.ts:79-217`;`apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service.ts:303-355` | TikHub、XorPay 等外部能力均有接入痕迹,但部分实现会在缺配置时回退到 stub/mock。 |

## 5. 关键遗漏 TOP 10

### 1. `employee_assignments` 员工分发路由系统缺失

PRD 原文(v2.0 重构):`"从'平台直连自动发布'改为'OpenClaw Bot → 飞书推送 → 员工手动发布'。员工绑定平台账号,视频生产完成后通过企业 OpenClaw Bot 推送飞书卡片。"`(5.1.5)

当前代码状态:`platform-account.service.ts:31-111` 只有账号 CRUD 和凭证存储;未发现 `employee_assignments` schema、飞书推送逻辑、员工确认回填链路。`distribution.service.ts` 有分发规则但不含员工绑定和飞书卡片推送。

**新架构要点**:不再需要管理 100 个社交账号密钥,改为:员工绑定表(`employee_assignments`)+ OpenClaw Skill 回调触发推送 + 飞书卡片(视频+文案+发布指引)+ 员工确认回填。

工作量:中(比原方案大幅简化)
优先级:P0

### 2. `production_batches` / `batch_id` / 断点续跑 / 汇总报告缺失

PRD 原文:`"生成 batch_id 追踪本次批量......断点续跑......汇总报告 → IM 群汇总通知 + Dashboard 展示。"`(5.1.7)

当前代码状态:`video.service.ts:48-112` 只能创建单任务并入队;`pipeline-system.service.ts:275-329` 的 warm-up 只是预热任务,不是批量编排器;未发现 `production_batches` collection。

工作量:大
优先级:P0

### 3. 三阶段向量查重与 `content_dedup` 未落地

PRD 原文:`"Phase 2: Milvus 向量召回......Phase 3: 豆包 2.0 Pro 多模态 AI 精判......content_dedup_{project_id}。"`(5.1.6)

当前代码状态:`pipeline.service.ts:38-182` 仅有后处理去重策略;未发现 Milvus schema、向量写入、批量查重命令、Phase 2/3 精判逻辑。

工作量:大
优先级:P0

### 4. Prompt Optimizer 智能返工引擎缺失

PRD 原文:`"不是简单重试,而是结构化分析'为什么当前 prompt 出了问题',输出可直接执行的优化 prompt。"`(5.1.8)

当前代码状态:仓库未发现 `prompt_fixes.json`、`needs_manual_review`、`optimized_prompt` 相关模型或服务;现有链路只有状态更新与审批,没有失败环节级返工。

工作量:中到大
优先级:P1

### 5. 生产迭代日志系统缺失

PRD 原文:`"没有完整日志 = 任务没有真正完成。"`(5.1.9)

当前代码状态:`video-task.schema.ts:145-192` 只有任务状态和少量 metadata;未发现 `iteration_log_{video_id}.json`、`batch_log_{batch_id}.json` 或等价持久化结构。

工作量:中
优先级:P1

### 6. ClawHost 自动开通仍是 stub,无法支撑"30 秒开通"

PRD 原文:`"Sprint 3+:注册成功 → ClawHost API 自动创建 Pod → 30 秒开通。"`(5.6.5 / 5.11.1)

当前代码状态:`clawhost.service.ts:37-90` 创建实例后调用 `stubCreateK8sPod`;`clawhost.service.ts:308-320` 日志返回 stub line;`clawhost.service.ts:457-464` 明确是 stub pod 创建。

工作量:大
优先级:P0

### 7. `video_analytics` 时序表与 T+1~T+90 效果飞轮缺失

PRD 原文:`"video_analytics 为唯一写入点,videos.analytics_snapshot 由定时任务同步最新值,不应直接写入。"`(5.4.3 / 7.1)

当前代码状态:`analytics.service.ts:15-320` 直接从 `VideoTask.metadata` 聚合 views/likes/comments;未发现 `video_analytics` collection、`recordedAt` TTL 索引或多周期采集持久化。

工作量:大
优先级:P0

### 8. 微信 OAuth 登录未实现

PRD 原文:`"微信扫码登录(OAuth 2.0,个人/企业通用)。"`(5.11.2)

当前代码状态:`auth.service.ts:118-125` 直接抛出 `WeChat OAuth not yet implemented`;`/Users/wes/projects/mediaclaw/web/src/app/auth/page.tsx` 中微信登录也是占位交互。

工作量:中
优先级:P1

### 9. 支付前端自助流程未对接后端

PRD 原文:`"用户选择条数包 → 创建订单(POST /v1/payment/create)→ 生成 XorPay 收银台 URL......用户扫码/跳转支付。"`(5.10.2)

当前代码状态:后端 `xorpay.controller.ts:28-116`、`xorpay.service.ts:88-385` 基本齐全;但 `/Users/wes/projects/mediaclaw/web/src/app/dashboard/billing/checkout/page.tsx:48-63` 只做 `setTimeout` 模拟支付成功,`/Users/wes/projects/mediaclaw/web/src/app/dashboard/billing/page.tsx:30` 仍是假数据。

工作量:中
优先级:P1

### 10. BYOK 完整闭环缺失

PRD 原文:`"Admin → 设置 → API Key 管理 → 填入 Kling/Gemini/DeepSeek Key......自动加密存储(AES-256)......该企业的所有视频生成任务自动使用自有 Key。"`(5.8.2)

当前代码状态:`organization.schema.ts:26-63` 没有 `apiKeys` 结构;`subscription.schema.ts:62-63` 只有单个 `encryptedApiKey`;`/Users/wes/projects/mediaclaw/web/src/app/dashboard/settings/page.tsx:30-69` 的 API Keys/Webhooks/Notifications 基本是静态 UI。

工作量:中到大
优先级:P1

## 6. 综合结论

- 这套代码不是"从零开始",而是一个已经具备后端主干的 V1.x 系统:认证、支付、内容审批、组织与成员、API Key、Webhook、审计、基础分析都真实存在。
- 但它距离 PRD v2.0 目标还有一条清晰的中枢能力缺口:员工分发路由(OpenClaw Bot → 飞书推送)、批量生产编排、向量查重、效果时序表、Prompt 返工和迭代日志都还没有落成真正的领域模型。当前实现更像"单任务生产 + 若干补丁式扩展",尚未进入 PRD 所要求的矩阵化规模阶段。
- 从 SOLID 视角看，现有模块边界基本清楚，但若继续补 PRD v2.0，建议把 `employee-dispatch`、`orchestration`、`analytics ingestion`、`dedup`、`delivery` 抽成独立域服务和独立 schema，而不是继续把状态塞进 `VideoTask.metadata`。
- 前端是当前交付短板。多个关键页面对后端能力没有真实接线,导致"后端已有、产品未闭环"的落差非常明显。

## 7. stdout 摘要

```text
PRD 审计完成。
可代码验证功能点 33 个:已实现 4,部分实现 23,未实现 6。
核心缺口集中在 employee_assignments(员工分发路由,v2.0 重构简化)、production_batches、content_dedup/Milvus、video_analytics、Prompt Optimizer、迭代日志、ClawHost 自动开通、微信 OAuth、支付前端接线、BYOK 闭环。
报告已写入 /Users/wes/projects/mediaclaw/server/PRD-AUDIT-REPORT.md
```
