# Codex Task: P1-7 IM 分发真实对接 + 管线匹配引擎

## Context
Working dir: `project/aitoearn-backend/`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Background
1. distribution.service.ts has rules/logic but IM push is stub/log — need real webhook-based delivery
2. PRD v2.1 adds pipeline matching engine (需求驱动管线匹配)

## Task 1: Webhook-Based IM Delivery

In `distribution.service.ts` or new `im-delivery.service.ts`:

Replace stub IM push with webhook delivery:
- `deliverViaWebhook(deliveryRecord, webhookUrl, payload)` — POST to configured webhook URL
  - Payload format: { videoUrl, coverUrl, title, copy, publishGuide, platform, assignedTo }
  - Handle timeout (10s), retry (3x with backoff)
  - Log delivery status to DeliveryRecord
- `buildFeishuCardPayload(videoTask, employee)` — build Feishu interactive card JSON
  - Card with: video thumbnail, title, copy text, platform tag, "确认发布" button URL
- `buildWecomCardPayload(videoTask, employee)` — build WeCom card JSON

Update `employee-dispatch.service.ts` (from P0-1):
- `dispatchToEmployee` → call `deliverViaWebhook` if employee has webhook configured
- Fallback: if no webhook, mark as 'pending' for manual pickup

Add webhook URL field to EmployeeAssignment:
- `@Prop() webhookUrl?: string` — OpenClaw/Feishu/WeCom webhook endpoint

## Task 2: Pipeline Matching Engine (v2.1)

Create `apps/aitoearn-server/src/core/mediaclaw/pipeline-match/` module:

### PipelineTemplate Schema Enhancement

Create or update `libs/mongodb/src/schemas/pipeline-template.schema.ts`:
```typescript
@Schema({ timestamps: true, collection: 'pipeline_templates' })
export class PipelineTemplate {
  @Prop({ required: true, unique: true }) templateId: string  // b7-ai-live, b9-product-showcase, etc.
  @Prop({ required: true }) name: string
  @Prop() description?: string
  @Prop({ type: [String], default: [] }) categories: string[]  // 美妆, 食品, 日用品...
  @Prop({ type: [String], default: [] }) styles: string[]  // 产品展示, 场景化, 开箱...
  @Prop({ type: [Number] }) durationRange?: [number, number]  // [min, max] seconds
  @Prop() costPerVideo?: number
  @Prop() qualityStars?: number  // 1-5
  @Prop({ type: [String], default: [] }) limitations: string[]
  @Prop({ type: [String], default: [] }) verifiedClients: string[]
  @Prop({ type: Object, default: {} }) defaultParams: Record<string, unknown>
  @Prop({ default: 'active' }) status: 'active' | 'draft' | 'deprecated'
}
```

Add to barrel.

### pipeline-match.service.ts

Methods:
- `matchPipeline(request)` — match request against template library
  - Request: { referenceVideoUrl?, category?, style?, duration?, budget?, description? }
  - Score each template: category match (40%) + style match (30%) + budget fit (15%) + duration fit (15%)
  - Return: sorted list of { templateId, matchScore, matchDetails, adjustments }
  - >80%: direct match, 60-80%: needs param tuning, <60%: new pipeline needed
- `analyzeReferenceVideo(videoUrl)` — extract video "recipe" (stub)
  - Stub: return structured analysis { category, style, duration, keyElements, suggestedTemplateType }
  - TODO: integrate with ContentRemixAgent for real analysis
- `suggestNewPipeline(request, matchResults)` — when no good match, suggest new pipeline spec
  - Return: { baseTemplateId, requiredChanges, estimatedDevTime, estimatedCost }
- `listTemplates(filters?)` — list available templates with capability tags
- `createTemplate(data)` — register a new pipeline template
- `updateTemplate(templateId, data)` — update template metadata

### pipeline-match.controller.ts

Routes:
- `POST /api/v1/pipelines/match` — match request to templates
- `POST /api/v1/pipelines/analyze-reference` — analyze reference video
- `GET /api/v1/pipelines/templates` — list templates
- `POST /api/v1/pipelines/templates` — create template
- `PATCH /api/v1/pipelines/templates/:id` — update template

### Seed Data

After module registration, seed the 3 existing templates:
- b7-ai-live: categories=[美妆,食品,日用品], styles=[产品展示,微动,场景化], cost=19.5, quality=3
- b9-product-showcase: categories=[美妆,食品,饮料], styles=[对标复刻,产品展示,开箱], cost=58, quality=5
- b10-explainer: categories=[教学,科普,酒吧], styles=[科普教学,规则讲解,教程], cost=1, quality=4

## Rules
- Webhook delivery: real HTTP calls with retry
- Pipeline matching: real scoring algorithm (not stub)
- Video analysis: stub with TODO
- Build pass + push after each commit
