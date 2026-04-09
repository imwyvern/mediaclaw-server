# Codex Task: P0-1 员工分发路由系统

## Context
Working dir: `project/aitoearn-backend/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.
Conventional Commits. 先定位再改，不要跳过调查直接写。

## Background
PRD v2.0 Section 5.1.5: 从"平台直连自动发布"改为"OpenClaw Bot → 飞书推送 → 员工手动发布"。
当前只有 `platform-account.service.ts`（账号 CRUD）和 `distribution.service.ts`（分发规则），
缺少员工绑定、飞书推送、确认回填链路。

## Task 1: EmployeeAssignment Schema

Create `libs/mongodb/src/schemas/employee-assignment.schema.ts`:

```typescript
@Schema({ timestamps: true, collection: 'employee_assignments' })
export class EmployeeAssignment {
  @Prop({ required: true, index: true }) orgId: string
  @Prop({ required: true }) employeeName: string
  @Prop({ required: true }) employeePhone: string
  @Prop() employeeUserId?: string  // MediaClaw user ID (if registered)
  @Prop({ type: [String], default: [] }) platformAccountIds: string[]  // bound platform accounts
  @Prop({ type: Object, default: {} }) imBinding: {
    feishu?: { openId: string; chatId?: string }
    wecom?: { userId: string; chatId?: string }
  }
  @Prop({ default: 'active' }) status: 'active' | 'inactive' | 'removed'
  @Prop({ type: Object, default: {} }) distributionRules: {
    maxDailyVideos?: number
    preferredPlatforms?: string[]
    preferredCategories?: string[]
  }
  @Prop({ type: Object, default: {} }) stats: {
    totalAssigned: number
    totalPublished: number
    totalPending: number
    lastAssignedAt?: Date
    lastPublishedAt?: Date
  }
}
```

Add to barrel `libs/mongodb/src/schemas/index.ts`.

## Task 2: DeliveryRecord Schema

Create `libs/mongodb/src/schemas/delivery-record.schema.ts`:

```typescript
@Schema({ timestamps: true, collection: 'delivery_records' })
export class DeliveryRecord {
  @Prop({ required: true, index: true }) orgId: string
  @Prop({ required: true, index: true }) videoTaskId: string
  @Prop({ required: true, index: true }) employeeAssignmentId: string
  @Prop({ required: true }) deliveryChannel: 'feishu' | 'wecom' | 'email' | 'manual'
  @Prop({ default: 'pending' }) status: 'pending' | 'delivered' | 'confirmed' | 'published' | 'failed'
  @Prop() deliveredAt?: Date
  @Prop() confirmedAt?: Date
  @Prop() publishedAt?: Date
  @Prop() publishUrl?: string
  @Prop() publishPlatform?: string
  @Prop() publishPostId?: string
  @Prop({ type: Object }) deliveryPayload?: Record<string, unknown>  // IM card payload sent
  @Prop() failReason?: string
  @Prop({ type: Number, default: 0 }) retryCount: number
}
```

Add to barrel.

## Task 3: Employee Dispatch Service

Create `apps/aitoearn-server/src/core/mediaclaw/employee-dispatch/` module (or extend existing):

### employee-dispatch.service.ts

Methods:
- `createAssignment(orgId, data)` — create employee assignment
- `updateAssignment(id, data)` — update employee binding/rules
- `removeAssignment(id)` — soft delete
- `listAssignments(orgId, filters, pagination)` — list with status filter
- `bindImAccount(assignmentId, channel, binding)` — bind feishu/wecom
- `dispatchToEmployee(videoTaskId, assignmentId)` — create delivery record + trigger IM push
- `batchDispatch(videoTaskIds, dispatchRules)` — batch dispatch by rules (round-robin, category match, load balance)
- `confirmDelivery(deliveryRecordId)` — employee confirms receipt
- `markPublished(deliveryRecordId, publishData)` — employee marks as published (URL + platform + postId)
- `getDispatchStats(orgId, period)` — aggregated stats

### IM Push (stub with interface)
- Define `ImPushService` interface with `pushVideoCard(binding, videoData)` method
- Implement `FeishuPushService` (stub: log the push, return success)
- Implement `WecomPushService` (stub: same)
- The real implementation will be done when we integrate OpenClaw delivery

### employee-dispatch.controller.ts

Routes:
- `POST /api/v1/dispatch/assignments` — create
- `GET /api/v1/dispatch/assignments` — list
- `PATCH /api/v1/dispatch/assignments/:id` — update
- `DELETE /api/v1/dispatch/assignments/:id` — remove
- `POST /api/v1/dispatch/assignments/:id/bind-im` — bind IM
- `POST /api/v1/dispatch/deliver` — dispatch video to employee (body: { videoTaskId, assignmentId })
- `POST /api/v1/dispatch/batch` — batch dispatch (body: { videoTaskIds, rules? })
- `POST /api/v1/dispatch/deliveries/:id/confirm` — confirm receipt
- `POST /api/v1/dispatch/deliveries/:id/published` — mark published
- `GET /api/v1/dispatch/stats` — stats

### employee-dispatch.module.ts

Register schemas (EmployeeAssignment, DeliveryRecord, VideoTask, PlatformAccount) + service + controller.
Register in `mediaclaw.module.ts`.

## Task 4: Integration with Distribution Service

In `distribution.service.ts`, add method:
- `dispatchByPipelineRules(pipelineId, videoTaskIds)` — load pipeline's distribution rules → resolve target employees → call `employee-dispatch.service.batchDispatch`

This connects the existing pipeline/distribution concept with the new employee dispatch.

## Rules
- Build must pass after each change
- Each logical change = one commit (Conventional Commits)
- No refactoring of unrelated code
- IM push services are stubs for now (log + return success) — clearly marked with TODO comments
- All schemas must be added to barrel and registered in module
