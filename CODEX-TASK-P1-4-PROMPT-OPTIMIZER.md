# Codex Task: P1-4 Prompt Optimizer 智能返工引擎

## Context
Working dir: `project/aitoearn-backend/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Background
PRD 5.1.8: AI 质检不通过时，结构化分析 prompt 失败原因 → 输出优化 prompt → 只重跑失败环节。
同一素材 2 轮仍不达标 → 切换生成策略。当前只有状态更新和简单重试。

## Task 1: IterationLog Schema

Create `libs/mongodb/src/schemas/iteration-log.schema.ts`:

```typescript
@Schema({ timestamps: true, collection: 'iteration_logs' })
export class IterationLog {
  @Prop({ required: true, index: true }) videoTaskId: string
  @Prop({ index: true }) batchId?: string
  @Prop({ required: true }) iteration: number  // 1, 2, 3...
  @Prop({ required: true }) stage: string  // 'frame_edit' | 'i2v_generate' | 'subtitle' | 'quality_check' | 'copy_generate'
  @Prop({ required: true }) status: 'success' | 'failed' | 'retried' | 'skipped'
  @Prop() originalPrompt?: string
  @Prop() optimizedPrompt?: string
  @Prop({ type: Object }) failureAnalysis?: {
    failReason: string       // structured reason
    failCategory: string     // 'quality' | 'content' | 'technical' | 'brand_mismatch'
    suggestedFixes: string[] // actionable suggestions
    confidence: number       // 0-1
  }
  @Prop({ type: Object }) qualityScore?: {
    total: number
    production: number  // 制作分 (0.4 weight)
    virality: number    // 传播分 (0.6 weight)
    dimensions: Record<string, number>  // 7 dimensions
  }
  @Prop() costCredits?: number
  @Prop() durationMs?: number
  @Prop() strategyUsed?: string  // 'default' | 'retry_optimized' | 'fallback_strategy'
  @Prop({ type: Object }) metadata?: Record<string, unknown>
}
```

Add to barrel.

## Task 2: Prompt Optimizer Service

Create `apps/aitoearn-server/src/core/mediaclaw/prompt-optimizer/` module:

### prompt-optimizer.service.ts

Methods:
- `analyzeFailure(videoTaskId, stage, originalPrompt, errorOrQualityResult)` — analyze why a stage failed
  - Stub: use heuristic rules to categorize failure
  - Return: { failReason, failCategory, suggestedFixes, optimizedPrompt }
  - Categories: quality (low score), content (irrelevant), technical (API error), brand_mismatch (wrong brand elements)
- `optimizePrompt(originalPrompt, failureAnalysis)` — generate optimized prompt
  - Stub: apply simple transformations (add specificity, adjust style keywords, add negative prompts)
  - TODO: replace with LLM-based optimization (DeepSeek/Gemini)
- `shouldRetry(videoTaskId)` — check iteration count, return { shouldRetry, strategy }
  - iteration < 2: retry with optimized prompt
  - iteration === 2: switch strategy (e.g., change template params, use different model)
  - iteration > 2: mark as needs_manual_review
- `logIteration(videoTaskId, stage, result)` — write iteration log
- `getIterationHistory(videoTaskId)` — return all iterations for a video
- `getBatchIterationSummary(batchId)` — aggregate iteration stats for a batch
  - Total iterations, success rate, common failure categories, avg iterations to success

### prompt-optimizer.controller.ts

Routes:
- `POST /api/v1/optimizer/analyze` — analyze failure (body: { videoTaskId, stage, prompt, error })
- `GET /api/v1/optimizer/history/:videoTaskId` — iteration history
- `GET /api/v1/optimizer/batch/:batchId/summary` — batch iteration summary

### prompt-optimizer.module.ts

Register IterationLog schema, service, controller.
Register in `mediaclaw.module.ts`.

## Task 3: Integration Points

In `video.service.ts` or `pipeline-system.service.ts`, add hook:
- After a task fails quality check → call `promptOptimizer.analyzeFailure()` → log iteration → if shouldRetry → re-queue with optimized prompt
- This is a stub integration (add the method calls but don't change the main flow significantly)

## Rules
- LLM integration is stub (heuristic rules for now)
- All stubs clearly marked with TODO
- Build pass + push after each commit
