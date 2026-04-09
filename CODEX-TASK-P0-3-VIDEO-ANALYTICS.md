# Codex Task: P0-3 效果数据回收 + video_analytics 时序表

## Context
Working dir: `project/aitoearn-backend/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Background
PRD 5.4.3 / 7.1: video_analytics 为唯一写入点，videos.analytics_snapshot 由定时任务同步最新值。
当前 analytics.service.ts 直接从 VideoTask.metadata 聚合，没有独立 collection 和时序采集。

## Task 1: VideoAnalytics Schema

Create `libs/mongodb/src/schemas/video-analytics.schema.ts`:

```typescript
@Schema({ timestamps: true, collection: 'video_analytics' })
export class VideoAnalytics {
  @Prop({ required: true, index: true }) videoTaskId: string
  @Prop({ required: true, index: true }) orgId: string
  @Prop({ required: true }) platform: string  // douyin, xiaohongshu, kuaishou, etc.
  @Prop() publishPostId?: string  // platform post ID
  @Prop({ required: true }) recordedAt: Date  // when this snapshot was taken
  @Prop({ required: true }) daysSincePublish: number  // T+1, T+2, ... T+90
  @Prop({ type: Object, required: true }) metrics: {
    views: number
    likes: number
    comments: number
    shares: number
    saves: number
    followers?: number  // new followers from this video
  }
  @Prop({ type: Object }) deltaFromPrevious?: {
    views: number
    likes: number
    comments: number
    shares: number
    saves: number
  }
  @Prop() dataSource: 'tikhub' | 'mediacrawler' | 'manual' | 'ocr'
  @Prop({ type: Object }) raw?: Record<string, unknown>  // raw API response
}
```

Add index: `{ videoTaskId: 1, recordedAt: -1 }` compound index.
Add TTL index on recordedAt (365 days) if needed.
Add to barrel.

## Task 2: Analytics Collection Service

Create or extend `apps/aitoearn-server/src/core/mediaclaw/analytics/`:

### analytics-collector.service.ts

Methods:
- `recordSnapshot(videoTaskId, platform, metrics, source)` — write one analytics record
  - Calculate daysSincePublish from video's publishedAt
  - Calculate deltaFromPrevious by comparing with last snapshot
  - Write to video_analytics collection
- `collectForVideo(videoTaskId)` — fetch latest data from TikHub API (stub) and record
  - Stub: generate realistic-looking metrics with slight daily growth
- `collectForOrg(orgId, period?)` — collect for all published videos in org
- `getVideoTimeSeries(videoTaskId, period?)` — return time series data points
- `getVideoLatestMetrics(videoTaskId)` — return most recent snapshot
- `syncAnalyticsSnapshot(videoTaskId)` — sync latest metrics to VideoTask.metadata.analytics (for fast reads)

### Scheduled Collection (concept only, stub)
- Add a method `runDailyCollection()` that:
  - Finds all published videos with publishedAt within last 90 days
  - For each: calls collectForVideo
  - Logs summary
  - Marked as TODO: wire to BullMQ scheduled job

## Task 3: Update Analytics Service

In existing `analytics.service.ts`:
- Add methods that read from `video_analytics` collection instead of aggregating from VideoTask.metadata
- `getOverview(orgId, period)` — aggregate from video_analytics
- `getTopContent(orgId, n, metric, period)` — top N by metric from video_analytics
- `getTrends(orgId, metric, period)` — daily/weekly trends from video_analytics
- Keep existing methods as fallback (for videos without analytics records)

## Task 4: Analytics Controller Updates

Add to existing analytics controller (or create new):
- `POST /api/v1/analytics/collect/:videoTaskId` — manually trigger collection for one video
- `GET /api/v1/analytics/video/:videoTaskId/timeseries` — time series
- `GET /api/v1/analytics/video/:videoTaskId/latest` — latest metrics

## Rules
- TikHub API integration is stub (generate mock but realistic data)
- Stub clearly marked with TODO
- Build pass + push after each commit
