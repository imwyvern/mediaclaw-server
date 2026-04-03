# MediaClaw Sprint 5-6: Enterprise + Deployment

## Context
Same conventions. Working dir: `project/aitoearn-backend/`
All modules in `apps/aitoearn-server/src/core/mediaclaw/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Task 1: Client/Org Management API
Create `apps/aitoearn-server/src/core/mediaclaw/client-mgmt/` module:
- `client-mgmt.module.ts`
- `client-mgmt.service.ts`:
  - `listOrgs(filters, pagination)` — admin: list all organizations
  - `getOrgDetail(orgId)` — admin: org details + stats
  - `updateOrgStatus(orgId, status)` — suspend/activate org
  - `listOrgMembers(orgId)` — list users in org
  - `updateMemberRole(orgId, userId, role)` — change user role
  - `removeOrgMember(orgId, userId)` — remove user from org
  - `inviteMember(orgId, phone, role)` — invite by phone
- `client-mgmt.controller.ts` — `api/v1/admin/orgs` CRUD + `/members` + `/invite`
- All endpoints require admin role (use existing RolesGuard)
- Register in `mediaclaw.module.ts`

## Task 2: Task Management API
Create `apps/aitoearn-server/src/core/mediaclaw/task-mgmt/` module:
- `task-mgmt.module.ts`
- `task-mgmt.service.ts`:
  - `createTask(orgId, params)` — create video production task
  - `getTask(taskId)` — get task details
  - `listTasks(orgId, filters, pagination)` — list with status/brand/date filters
  - `cancelTask(taskId)` — cancel pending task, refund credit
  - `retryTask(taskId)` — retry failed task
  - `batchDownload(taskIds)` — return download URLs for multiple tasks
  - `getTaskTimeline(taskId)` — return status history (created→queued→processing→completed)
- `task-mgmt.controller.ts` — `api/v1/tasks` CRUD + `/cancel`, `/retry`, `/batch-download`, `/timeline/:id`
- Register in `mediaclaw.module.ts`

## Task 3: Competitor Analysis API
Create `apps/aitoearn-server/src/core/mediaclaw/competitor/` module:
- New schema `libs/mongodb/src/schemas/competitor.schema.ts`:
  - `orgId`, `platform`, `accountId`, `accountName`, `accountUrl`
  - `metrics` (followers, avgViews, avgLikes, postFrequency)
  - `lastSyncedAt`, `isActive`
- Add to barrel + register
- `competitor.service.ts`:
  - `addCompetitor(orgId, platform, accountUrl)` — start tracking
  - `listCompetitors(orgId)` — list tracked accounts
  - `getIndustryHot(industry, platform, period)` — trending content in industry
  - `removeCompetitor(id)` — stop tracking
- `competitor.controller.ts` — `api/v1/competitors` CRUD + `/industry-hot`
- Register in `mediaclaw.module.ts`

## Task 4: Asset Version Management
Create `apps/aitoearn-server/src/core/mediaclaw/asset/` module:
- New schema `libs/mongodb/src/schemas/brand-asset-version.schema.ts`:
  - `brandId`, `assetType` (logo/font/color-palette/slogan), `version` (number)
  - `fileUrl`, `fileName`, `fileSize`, `mimeType`
  - `uploadedBy`, `isActive`, `metadata` (Mixed)
- Add to barrel + register
- `asset.service.ts`:
  - `uploadAsset(brandId, type, file)` — upload new version (increment version)
  - `listVersions(brandId, type)` — list all versions
  - `setActive(assetId)` — set as active version
  - `getActiveAsset(brandId, type)` — get current active
  - `deleteVersion(assetId)` — soft delete old version
- `asset.controller.ts` — `api/v1/assets` CRUD + `/versions`, `/activate`
- Register in `mediaclaw.module.ts`

## Task 5: Health & Monitoring Enhancement
Enhance existing health module `apps/aitoearn-server/src/core/mediaclaw/health/`:
- Add `health-check.service.ts` (or enhance existing):
  - `getSystemHealth()` — MongoDB ping, Redis ping, BullMQ queue depth, disk usage
  - `getWorkerStatus()` — active/waiting/completed/failed job counts
  - `getStorageUsage()` — total files, total size (from brand assets)
  - `getApiMetrics()` — request count, avg response time (from audit logs)
- Add NestJS `@nestjs/terminus` HealthModule (install if not present)
- Endpoints: `GET /api/v1/health/system`, `/workers`, `/storage`, `/metrics`
- Update existing health controller

## Task 6: Pipeline System
Create `apps/aitoearn-server/src/core/mediaclaw/pipeline-system/` module:
- New schema `libs/mongodb/src/schemas/pipeline-template.schema.ts`:
  - `name`, `type` (seeding/review/new-product/brand-story/promo)
  - `steps[]` ({ name, config, order })
  - `defaultParams` (duration, aspectRatio, subtitleStyle, musicStyle)
  - `isPublic`, `createdBy`, `usageCount`
- Add to barrel + register
- `pipeline-system.service.ts`:
  - `createTemplate(data)` — create pipeline template
  - `listTemplates(filters)` — list by type/public
  - `getTemplate(id)` — get with steps
  - `applyTemplate(templateId, brandId, overrides)` — create pipeline from template
  - `learnPreference(pipelineId, feedback)` — update preference weights (boss>ops>performance)
  - `warmUp(pipelineId)` — pre-generate first batch for testing
- `pipeline-system.controller.ts` — `api/v1/pipelines` CRUD + `/apply`, `/learn`, `/warm-up`
- Register in `mediaclaw.module.ts`

## After ALL tasks:
1. `npx nx build aitoearn-server` — must pass
2. 6 atomic commits (one per task), push after each
3. Print "ALL SPRINT 5-6 TASKS COMPLETE" at end
