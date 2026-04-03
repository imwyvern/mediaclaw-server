# MediaClaw Sprint 3-4 Backend Tasks

## Context
Same as before. Working dir: `project/aitoearn-backend/`
All existing modules in `apps/aitoearn-server/src/core/mediaclaw/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Conventional Commits. Build must pass before each commit. Push after commit.

## Task 1: mediaclaw-client Skill (OpenClaw Skill)
Create `apps/aitoearn-server/src/core/mediaclaw/skill/` module:
- `skill.module.ts`
- `skill.service.ts` — manages Skill lifecycle
  - `registerAgent(agentId, capabilities)` — register an OpenClaw agent
  - `getAgentConfig(agentId)` — return config for agent (brands, pipelines, preferences)
  - `submitFeedback(agentId, taskId, feedback)` — collect boss/ops feedback
  - `getPendingDeliveries(agentId)` — return completed videos awaiting delivery
  - `confirmDelivery(agentId, taskId)` — mark as delivered
- `skill.controller.ts` — endpoints under `api/v1/skill/`:
  - `POST /register`, `GET /config`, `POST /feedback`, `GET /deliveries`, `POST /confirm-delivery`
  - All endpoints require API key auth (use existing apikey guard)
- Register in `mediaclaw.module.ts`

## Task 2: Analytics API (Sprint 4+5)
Create `apps/aitoearn-server/src/core/mediaclaw/analytics/` module:
- `analytics.module.ts`
- `analytics.service.ts`:
  - `getOverview(orgId)` — total videos, credits used, success rate, avg production time
  - `getVideoStats(taskId)` — single video performance (views/likes/comments from metadata)
  - `getTrends(orgId, period)` — daily/weekly/monthly video production & performance trends
  - `getTopContent(orgId, limit)` — top performing videos by engagement
  - For now use aggregation on VideoTask collection (real platform data integration later)
- `analytics.controller.ts` — `api/v1/analytics/overview`, `/stats/:id`, `/trends`, `/top`
- Register in `mediaclaw.module.ts`

## Task 3: Campaign & Scheduling API
Create `apps/aitoearn-server/src/core/mediaclaw/campaign/` module:
- New schema `libs/mongodb/src/schemas/campaign.schema.ts`:
  - `orgId`, `name`, `brandId`, `pipelineId`, `status` (draft/active/paused/completed)
  - `schedule` (cron, videosPerRun, timezone)
  - `targetPlatforms[]`, `totalPlanned`, `totalProduced`, `totalPublished`
  - `startDate`, `endDate`, `metadata`
- Add to barrel + register in mediaclaw.module.ts
- `campaign.service.ts` — CRUD + start/pause/complete
- `campaign.controller.ts` — `api/v1/campaign` CRUD + `/start`, `/pause`

## Task 4: Audit Log System
Create `apps/aitoearn-server/src/core/mediaclaw/audit/` module:
- New schema `libs/mongodb/src/schemas/audit-log.schema.ts`:
  - `orgId`, `userId`, `action` (string), `resource` (string), `resourceId`, `details` (Mixed)
  - `ipAddress`, `userAgent`
  - TTL index: 90 days auto-delete
- Add to barrel + register
- `audit.service.ts` — `log(event)`, `query(orgId, filters, pagination)`
- `audit.controller.ts` — `GET /api/v1/audit-logs` with pagination + filters
- `audit.interceptor.ts` — NestJS interceptor that auto-logs write operations (POST/PATCH/DELETE)

## Task 5: Webhook Integration
Create `apps/aitoearn-server/src/core/mediaclaw/webhook/` module:
- New schema `libs/mongodb/src/schemas/webhook.schema.ts`:
  - `orgId`, `name`, `url`, `secret`, `events[]` (task.completed, payment.success, etc.)
  - `isActive`, `lastTriggeredAt`, `failCount`
- Add to barrel + register
- `webhook.service.ts`:
  - `register(orgId, url, events)` — create webhook
  - `trigger(event, payload)` — POST to all matching webhooks with HMAC signature
  - `listByOrg(orgId)` — list webhooks
  - `delete(id)` — remove webhook
- `webhook.controller.ts` — CRUD under `api/v1/webhook`
- Wire trigger into distribution.service.ts (on task complete, call webhook.trigger)

## After ALL tasks:
1. `npx nx build aitoearn-server` — must pass
2. `git add -A && git commit` per task (5 atomic commits)
3. `git push` after each
4. Print "ALL SPRINT 3-4 TASKS COMPLETE" at end
