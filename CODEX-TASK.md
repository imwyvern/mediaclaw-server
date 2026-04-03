# MediaClaw Sprint 2-3 Backend Tasks

## Context
You are working on MediaClaw, a video content SaaS built on AiToEarn's NestJS + Nx monorepo.
- Working directory: `project/aitoearn-backend/`
- Sprint 1-2 partial already done: schemas, auth, brand, org, billing, health, video, payment, pipeline, account modules
- All code is in `apps/aitoearn-server/src/core/mediaclaw/`
- Schemas in `libs/mongodb/src/schemas/` (barrel export from `libs/mongodb/src/schemas/index.ts`)
- PRD at `/Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v1.9.md`

## RULES
- Import schemas from `@yikart/mongodb` (barrel only, no deep paths)
- Schema pattern: `DEFAULT_SCHEMA_OPTIONS` + `WithTimestampSchema` + `SchemaFactory.createForClass`
- Process.env access: use `process.env['KEY']` not `process.env.KEY` (TS4111)
- Conventional Commits: `feat(scope): description`
- Atomic commits per feature
- Run `npx nx build aitoearn-server` before each commit — must pass 17/17 tasks
- `git push` after each commit

## Task 1: Video Worker (BullMQ job queue)
Create `apps/aitoearn-server/src/core/mediaclaw/worker/` module:
- Install BullMQ: check if `bullmq` is already in package.json, if not add it
- `video-worker.processor.ts` — BullMQ processor that handles video production jobs
  - Job types: `analyze-source`, `edit-frames`, `render-video`, `quality-check`, `generate-copy`
  - Each step updates VideoTask status via VideoService
  - On failure: retry up to 3 times, then mark failed
  - On complete: update task with outputVideoUrl, quality metadata, copy
- `worker.module.ts` — registers BullMQ queue + processor
- Wire into `mediaclaw.module.ts`
- For now, each job step can be a stub that logs + sleeps 1s (real implementation later)

## Task 2: Copy Engine
Create `apps/aitoearn-server/src/core/mediaclaw/copy/` module:
- `copy.service.ts` — generates video titles, subtitles, hashtags, comment guides
  - `generateCopy(brandId, videoUrl, metadata)` → returns `{ title, subtitle, hashtags[], commentGuide }`
  - Uses brand tone keywords + avoid keywords from Brand schema
  - For now: stub that returns template copy with brand name injected
  - TODO marker for DeepSeek API integration
- `copy.module.ts`
- Wire into `mediaclaw.module.ts`

## Task 3: API Key System for Agent Auth
Create `apps/aitoearn-server/src/core/mediaclaw/apikey/` module:
- New schema `libs/mongodb/src/schemas/api-key.schema.ts`:
  - `key` (hashed, unique), `prefix` (first 8 chars, for display), `name`, `userId`, `orgId`, `permissions[]`, `lastUsedAt`, `expiresAt`, `isActive`
- Add to barrel export in `libs/mongodb/src/schemas/index.ts`
- `apikey.service.ts` — create, list, revoke, validate
  - Key format: `mc_live_` + 32 random hex chars
  - Store SHA256 hash, return raw key only on creation
- `apikey.controller.ts` — `POST /api/v1/apikey`, `GET /api/v1/apikey`, `DELETE /api/v1/apikey/:id`
- `apikey.guard.ts` — middleware that accepts `Authorization: Bearer mc_live_xxx` as alternative to JWT
- Register in `mediaclaw.module.ts`

## Task 4: Heartbeat Endpoint Enhancement
Update `health.controller.ts`:
- `POST /api/v1/heartbeat` — accepts `{ clientVersion, agentId, capabilities }` from mediaclaw-client Skill
  - Records last heartbeat timestamp per agent
  - Returns pending tasks for that agent (from VideoTask queue)
  - Returns config updates if any

## Task 5: Webhook / IM Distribution Stub  
Create `apps/aitoearn-server/src/core/mediaclaw/distribution/` module:
- `distribution.service.ts`:
  - `notifyTaskComplete(task)` — sends result to webhook URL or IM group
  - `notifyPaymentSuccess(order)` — sends payment confirmation
  - For now: just log the notification (actual IM integration in Sprint 3)
- `distribution.module.ts`
- Wire into `mediaclaw.module.ts`

## After ALL tasks done:
1. `npx nx build aitoearn-server` — must pass
2. `git add -A && git commit` with appropriate message
3. `git push`
4. Print "ALL TASKS COMPLETE" at the end
