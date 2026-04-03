# MediaClaw Sprint 7-8: Final Backend Features

## Context
Same conventions. Working dir: `project/aitoearn-backend/`
All modules in `apps/aitoearn-server/src/core/mediaclaw/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Task 1: Notification System
Create `apps/aitoearn-server/src/core/mediaclaw/notification/` module:
- New schema `libs/mongodb/src/schemas/notification-config.schema.ts`:
  - `orgId`, `channel` (email/webhook/sms/wechat)
  - `events[]` (task.completed/task.failed/subscription.expiring/credit.low)
  - `config` (Mixed: email addresses, webhook URLs, phone numbers)
  - `isActive`
- Add to barrel + register
- `notification.service.ts`:
  - `createConfig(orgId, data)` — add notification config
  - `listConfigs(orgId)` — list configs
  - `updateConfig(id, data)` — update
  - `deleteConfig(id)` — delete
  - `send(orgId, event, payload)` — dispatch notification (log only for now)
  - `testConfig(id)` — send test notification
- `notification.controller.ts` — `api/v1/notifications` CRUD + `/test`
- Register in `mediaclaw.module.ts`

## Task 2: Report Generation API
Create `apps/aitoearn-server/src/core/mediaclaw/report/` module:
- New schema `libs/mongodb/src/schemas/report.schema.ts`:
  - `orgId`, `type` (weekly/monthly/campaign/brand)
  - `period` ({ start: Date, end: Date })
  - `metrics` (Mixed: totalVideos, successRate, avgCost, topBrands, etc.)
  - `fileUrl` (generated PDF/CSV link)
  - `status` (generating/ready/failed)
  - `generatedAt`
- Add to barrel + register
- `report.service.ts`:
  - `generateReport(orgId, type, period)` — create report (compute metrics from existing data)
  - `listReports(orgId, filters)` — list with type/date filter
  - `getReport(id)` — get report detail
  - `scheduleAutoReport(orgId, config)` — set up recurring reports
  - `deleteReport(id)` — delete old report
- `report.controller.ts` — `api/v1/reports` CRUD + `/generate`, `/schedule`
- Register in `mediaclaw.module.ts`

## Task 3: Platform Account Management
Create `apps/aitoearn-server/src/core/mediaclaw/platform-account/` module:
- New schema `libs/mongodb/src/schemas/platform-account.schema.ts`:
  - `orgId`, `platform` (douyin/kuaishou/xiaohongshu/bilibili/wechat-video)
  - `accountId`, `accountName`, `avatarUrl`
  - `credentials` (Mixed, encrypted)
  - `status` (active/expired/suspended)
  - `metrics` (followers, totalViews, avgEngagement)
  - `lastSyncedAt`
- Add to barrel + register
- `platform-account.service.ts`:
  - `addAccount(orgId, platform, credentials)` — link platform account
  - `listAccounts(orgId)` — list all linked accounts
  - `syncMetrics(accountId)` — refresh metrics (stub)
  - `removeAccount(id)` — unlink
  - `getPublishHistory(accountId, pagination)` — list published videos
- `platform-account.controller.ts` — `api/v1/platform-accounts` CRUD + `/sync`, `/history`
- Register in `mediaclaw.module.ts`

## Task 4: Template Marketplace
Create `apps/aitoearn-server/src/core/mediaclaw/marketplace/` module:
- New schema `libs/mongodb/src/schemas/marketplace-template.schema.ts`:
  - `pipelineTemplateId` (ref), `authorOrgId`
  - `title`, `description`, `thumbnailUrl`, `tags[]`
  - `price` (0 = free), `currency` (CNY)
  - `downloads`, `rating`, `reviewCount`
  - `isApproved`, `isFeatured`
- Add to barrel + register
- `marketplace.service.ts`:
  - `publishTemplate(orgId, pipelineTemplateId, data)` — publish to marketplace
  - `listTemplates(filters, sort, pagination)` — browse marketplace
  - `getTemplate(id)` — detail with reviews
  - `purchaseTemplate(orgId, templateId)` — "buy"/download template
  - `rateTemplate(orgId, templateId, rating, review)` — leave review
  - `featureTemplate(id)` — admin: mark as featured
- `marketplace.controller.ts` — `api/v1/marketplace` browse + `/publish`, `/purchase`, `/rate`, `/feature`
- Register in `mediaclaw.module.ts`

## Task 5: API Rate Limiting & Usage Tracking
Create `apps/aitoearn-server/src/core/mediaclaw/usage/` module:
- New schema `libs/mongodb/src/schemas/api-usage.schema.ts`:
  - `orgId`, `apiKey`, `endpoint`, `method`
  - `requestCount`, `date` (YYYY-MM-DD string)
  - `responseTimeMs` (avg)
- Add to barrel + register
- `usage.service.ts`:
  - `trackRequest(orgId, apiKey, endpoint, method, responseTimeMs)` — log API usage
  - `getUsageSummary(orgId, period)` — aggregate usage stats
  - `getQuotaStatus(orgId)` — remaining quota vs plan limits
  - `getRateLimitStatus(apiKey)` — current rate vs limit
- `usage.controller.ts` — `api/v1/usage` summary + `/quota`, `/rate-limit`
- Add a NestJS interceptor `UsageTrackingInterceptor` in `apps/aitoearn-server/src/core/mediaclaw/usage/usage-tracking.interceptor.ts`:
  - Intercept all `/api/v1/*` requests, log to apiUsage collection
  - Apply via `@UseInterceptors()` on MediaClaw controllers
- Register in `mediaclaw.module.ts`

## After ALL tasks:
1. `npx nx build aitoearn-server` — must pass
2. 5 atomic commits (one per task), push after each
3. Print "ALL SPRINT 7-8 TASKS COMPLETE" at end
