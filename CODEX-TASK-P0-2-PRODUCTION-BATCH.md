# Codex Task: P0-2 生产编排器 + Batch 批量生产

## Context
Working dir: `project/aitoearn-backend/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Background
PRD 5.1.7: 生产编排器 — 自动化每日内容工厂。当前只能创建单任务 (video.service.ts)，
缺少 `production_batches` collection、batch_id 追踪、断点续跑、整批统计。

## Task 1: ProductionBatch Schema

Create `libs/mongodb/src/schemas/production-batch.schema.ts`:

```typescript
@Schema({ timestamps: true, collection: 'production_batches' })
export class ProductionBatch {
  @Prop({ required: true, unique: true }) batchId: string  // 'batch_YYYYMMDD_HHmmss_xxxx'
  @Prop({ required: true, index: true }) orgId: string
  @Prop() pipelineId?: string
  @Prop() templateId?: string  // b7-ai-live, b9-product-showcase, etc.
  @Prop({ required: true }) totalCount: number
  @Prop({ default: 0 }) completedCount: number
  @Prop({ default: 0 }) failedCount: number
  @Prop({ default: 0 }) skippedCount: number  // already completed on resume
  @Prop({ default: 'pending' }) status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  @Prop({ type: [String], default: [] }) videoTaskIds: string[]
  @Prop({ type: [String], default: [] }) completedTaskIds: string[]
  @Prop({ type: [String], default: [] }) failedTaskIds: string[]
  @Prop({ type: Object, default: {} }) params: Record<string, unknown>  // batch-level params
  @Prop({ type: Object }) summary?: {
    avgCostPerVideo: number
    totalCost: number
    avgDurationSec: number
    successRate: number
    startedAt: Date
    completedAt?: Date
    elapsedMs: number
  }
  @Prop({ type: Object }) resumeState?: {
    lastProcessedIndex: number
    resumedAt: Date
    resumeCount: number
  }
  @Prop() startedAt?: Date
  @Prop() completedAt?: Date
  @Prop() cancelledAt?: Date
  @Prop() errorMessage?: string
}
```

Add to barrel.

## Task 2: Production Orchestrator Service

Create `apps/aitoearn-server/src/core/mediaclaw/production/` module:

### production-orchestrator.service.ts

Methods:
- `createBatch(orgId, params)` — create batch record, generate batchId, create individual video tasks
  - params: { templateId, count, pipelineId?, brandAssets?, styleOverrides?, referenceVideoUrl? }
  - Create `count` VideoTask records linked to batch
  - Return batch with all taskIds
- `startBatch(batchId)` — mark running, start processing tasks sequentially
  - For each task: update status → call pipeline execution (stub: simulate with delay + random success/fail)
  - Update completedCount/failedCount as tasks finish
  - If task fails and retryCount < 2: re-queue
  - When all done: update summary stats + mark completed
- `pauseBatch(batchId)` — mark paused, stop processing new tasks
- `resumeBatch(batchId)` — mark running, skip already-completed tasks (断点续跑)
  - Read completedTaskIds → skip those → continue from lastProcessedIndex
- `cancelBatch(batchId)` — mark cancelled, cancel pending tasks
- `getBatch(batchId)` — return batch with stats
- `listBatches(orgId, filters, pagination)` — list batches with status filter
- `getBatchSummary(batchId)` — detailed summary (per-task status, timing, cost)

### production.controller.ts

Routes:
- `POST /api/v1/production/batches` — create batch
- `GET /api/v1/production/batches` — list
- `GET /api/v1/production/batches/:batchId` — get single
- `POST /api/v1/production/batches/:batchId/start` — start
- `POST /api/v1/production/batches/:batchId/pause` — pause
- `POST /api/v1/production/batches/:batchId/resume` — resume (断点续跑)
- `POST /api/v1/production/batches/:batchId/cancel` — cancel
- `GET /api/v1/production/batches/:batchId/summary` — detailed summary

### production.module.ts

Register ProductionBatch + VideoTask schemas, service, controller.
Register in `mediaclaw.module.ts`.

## Task 3: Link VideoTask to Batch

Update `video-task.schema.ts` (if not already present):
- Add `batchId?: string` field (index)
- Add `batchIndex?: number` field (position in batch)

## Rules
- Pipeline execution is stub for now (simulate with setTimeout + random success/fail 70/30)
- Stub clearly marked with TODO
- Build pass + push after each commit
- Conventional Commits
