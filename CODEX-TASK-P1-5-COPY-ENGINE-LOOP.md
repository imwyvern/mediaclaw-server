# Codex Task: P1-5 文案引擎效果闭环 + 统一 HTTP 入口

## Context
Working dir: `project/aitoearn-backend/`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Background
PRD 5.2: 文案引擎已有 DeepSeek/Gemini/heuristic fallback、历史去重、品牌关键词、蓝词。
缺少：1) 统一的 `POST /api/v1/copy/generate` HTTP 入口 2) 效果回收 → 策略更新的持久化闭环。

## Task 1: Add generateCopy HTTP Endpoint

In `copy.controller.ts`, add:
- `POST /api/v1/copy/generate` — unified copy generation endpoint
  - Body: { videoTaskId?, brandId?, theme?, platform?, style?, count? }
  - Calls existing copy-engine.service to generate title + subtitle + hashtags + blueWords + commentGuide
  - Returns generated copy set

- `POST /api/v1/copy/rewrite` — rewrite existing copy
  - Body: { copyId, instructions? }
  - Calls LLM to rewrite based on instructions

## Task 2: CopyPerformance Schema

Create `libs/mongodb/src/schemas/copy-performance.schema.ts`:

```typescript
@Schema({ timestamps: true, collection: 'copy_performance' })
export class CopyPerformance {
  @Prop({ required: true, index: true }) copyHistoryId: string  // link to copy-history
  @Prop({ required: true, index: true }) videoTaskId: string
  @Prop({ required: true }) orgId: string
  @Prop({ required: true }) platform: string
  @Prop({ type: Object }) metrics: {
    views: number
    likes: number
    comments: number
    shares: number
    saves: number
    ctr?: number  // click-through rate if available
  }
  @Prop({ type: Object }) copyFeatures: {
    titleLength: number
    hasBlueWords: boolean
    blueWordCount: number
    hasCommentGuide: boolean
    hashtagCount: number
    emotionalTone: string  // 'neutral' | 'exciting' | 'curious' | 'urgent'
  }
  @Prop() performanceScore: number  // 0-100, calculated from metrics
  @Prop() recordedAt: Date
}
```

Add to barrel.

## Task 3: Copy Strategy Learning Service

In `copy-engine.service.ts` or new `copy-strategy.service.ts`:

Methods:
- `recordCopyPerformance(copyHistoryId, videoTaskId, metrics)` — write performance record + extract features
- `getTopPerformingPatterns(orgId, platform, limit)` — analyze top copy patterns
  - Group by features (titleLength range, hasBlueWords, tone) → rank by avg performance
  - Return: top patterns with example copies
- `updateStrategyFromPerformance(orgId)` — analyze recent performance → update copy generation strategy
  - Stub: calculate which features correlate with high performance
  - Store updated strategy hints in org settings or dedicated collection
  - TODO: feed these hints into LLM prompt for next generation
- `getCopyInsights(orgId, period)` — return insights dashboard data
  - Best performing title patterns, optimal hashtag count, blue word effectiveness

## Task 4: Controller for Copy Analytics

Add routes:
- `POST /api/v1/copy/performance` — record copy performance (body: { copyHistoryId, videoTaskId, metrics })
- `GET /api/v1/copy/insights` — copy performance insights
- `GET /api/v1/copy/top-patterns` — top performing patterns

## Rules
- Build pass + push after each commit
- Performance analysis is real aggregation logic (not stub), but strategy update effect on generation is stub (TODO: wire into LLM prompt)
