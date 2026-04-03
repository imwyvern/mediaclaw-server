# MediaClaw Sprint 9: IM Distribution + Auth Enhancement + Testing

## Context
Same conventions. Working dir: `project/aitoearn-backend/`
All modules in `apps/aitoearn-server/src/core/mediaclaw/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Task 1: IM Distribution Engine
Create `apps/aitoearn-server/src/core/mediaclaw/distribution/` module (enhance existing stub):
- New schema `libs/mongodb/src/schemas/distribution-rule.schema.ts`:
  - `orgId`, `name`, `type` (by-employee/by-platform/by-dimension)
  - `rules[]` ({ condition: Mixed, action: string, target: string })
  - `isActive`, `priority` (number)
- Add to barrel + register
- `distribution.service.ts`:
  - `createRule(orgId, data)` — create distribution rule
  - `listRules(orgId)` — list rules by priority
  - `updateRule(id, data)` — update rule
  - `deleteRule(id)` — delete
  - `evaluateRules(orgId, content)` — evaluate which rule matches content
  - `distribute(orgId, contentId, targets)` — push content to targets
  - `trackPublishStatus(contentId, status)` — update: completed→pushed→published→expired
  - `collectFeedback(contentId, employeeId, feedback)` — collect employee callback
- `distribution.controller.ts` — `api/v1/distribution` CRUD + `/evaluate`, `/push`, `/status`, `/feedback`
- Register in `mediaclaw.module.ts`

## Task 2: Phone + Enterprise Auth Enhancement
Enhance `apps/aitoearn-server/src/core/mediaclaw/auth/`:
- Add `enterprise-auth.service.ts`:
  - `registerEnterprise(data)` — create org + admin user + trial subscription
  - `inviteByPhone(orgId, phone, role)` — send SMS invite
  - `acceptInvite(token, phone, code)` — verify SMS + join org
  - `switchOrg(userId, orgId)` — switch active organization
  - `listUserOrgs(userId)` — list orgs user belongs to
- Update auth controller with enterprise endpoints:
  - `POST /api/v1/auth/enterprise/register`
  - `POST /api/v1/auth/enterprise/invite`
  - `POST /api/v1/auth/enterprise/accept-invite`
  - `POST /api/v1/auth/switch-org`
  - `GET /api/v1/auth/my-orgs`

## Task 3: Content Management API (L2 Skill Support)
Create `apps/aitoearn-server/src/core/mediaclaw/content-mgmt/` module:
- `content-mgmt.service.ts`:
  - `editCopy(contentId, title, subtitle, hashtags)` — update content copy
  - `markPublished(contentId, platform, publishUrl)` — mark as published
  - `setStylePreferences(orgId, prefs)` — save brand style preferences
  - `getStylePreferences(orgId)` — get preferences
  - `listContent(orgId, filters, pagination)` — list with status/brand/date filters
  - `batchEditCopy(contentIds, updates)` — batch update multiple items
  - `exportContent(orgId, format, filters)` — export to CSV/JSON
- `content-mgmt.controller.ts` — `api/v1/content` enhanced CRUD
- Register in `mediaclaw.module.ts`

## Task 4: Manage Script (manage.sh)
Create `scripts/manage.sh` in project root:
```bash
#!/usr/bin/env bash
# MediaClaw Management Script
# Usage: ./manage.sh <command> [options]
# Commands: create|start|stop|status|upgrade-skill|logs|health
```
- `create` — docker compose up -d (first time setup)
- `start` — docker compose start
- `stop` — docker compose stop
- `status` — show running containers + port mapping + health
- `upgrade-skill` — pull latest skill image + restart skill container
- `logs [service]` — tail logs for specific service or all
- `health` — curl health endpoints for all services
- Make executable (chmod +x)

## After ALL tasks:
1. `npx nx build aitoearn-server` — must pass
2. 4 atomic commits (one per task), push after each
3. Print "ALL SPRINT 9 TASKS COMPLETE" at end
