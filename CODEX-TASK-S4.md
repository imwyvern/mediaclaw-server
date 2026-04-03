# MediaClaw Sprint 4: Data Acquisition + Copy Engine v2

## Context
Same conventions. Working dir: `project/aitoearn-backend/`
All modules in `apps/aitoearn-server/src/core/mediaclaw/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Task 1: TikHub API Integration
Create `apps/aitoearn-server/src/core/mediaclaw/acquisition/` module:
- `acquisition.module.ts`
- `tikhub.service.ts`:
  - `searchVideos(platform, keyword, limit)` — search Douyin/XHS/Kuaishou/Bilibili via TikHub API
  - `getVideoDetail(platform, videoId)` — get video metadata
  - `trackPerformance(videoId)` — track views/likes/comments at T+1/T+3/T+7/T+30/T+90
  - `getSourceVideo(videoUrl)` — download source video for remix
  - For now use stub HTTP calls with correct TikHub API contract (base URL from env: `TIKHUB_API_KEY`, `TIKHUB_BASE_URL`)
  - Document API contract in code comments
- `acquisition.controller.ts` — `api/v1/acquisition/search`, `/detail/:id`, `/track/:id`, `/source`
- Register in `mediaclaw.module.ts`

## Task 2: Crawl Queue (MediaCrawlerPro stub)
Create `apps/aitoearn-server/src/core/mediaclaw/crawler/` module:
- `crawler.module.ts`
- `crawler.service.ts`:
  - `enqueueCrawl(platform, keyword, depth)` — add to BullMQ crawl queue
  - `getCrawlStatus(jobId)` — check crawl progress
  - `getCrawlResults(jobId)` — return crawled content
  - `dualLayerRoute(query)` — TikHub API first, if insufficient → MediaCrawlerPro supplement
  - BullMQ queue name: `mediaclaw:crawl`
- `crawler.controller.ts` — `api/v1/crawler/enqueue`, `/status/:id`, `/results/:id`
- Register in `mediaclaw.module.ts`

## Task 3: Viral Discovery Engine
Create `apps/aitoearn-server/src/core/mediaclaw/discovery/` module:
- New schema `libs/mongodb/src/schemas/viral-content.schema.ts`:
  - `platform`, `videoId`, `title`, `author`, `viralScore` (number), `views`, `likes`, `comments`, `shares`
  - `industry`, `keywords[]`, `discoveredAt`, `contentUrl`, `thumbnailUrl`
  - `remixStatus` (pending/remixed/rejected), `remixTaskId`
- Add to barrel + register
- `discovery.service.ts`:
  - `calculateViralScore(metrics)` — weighted score (views*0.3 + likes*0.25 + comments*0.25 + shares*0.2), normalized
  - `filterP90(industry)` — return top 10% by viralScore
  - `getRecommendationPool(orgId, limit)` — curated list for remixing
  - `markRemixed(contentId, taskId)` — link to video task
  - Cron-ready: `@Cron` decorated method for periodic scanning (stubbed)
- `discovery.controller.ts` — `api/v1/discovery/pool`, `/score`, `/mark-remixed`
- Register in `mediaclaw.module.ts`

## Task 4: Copy Engine v2 Upgrade
Upgrade existing `apps/aitoearn-server/src/core/mediaclaw/copy/copy-engine.service.ts`:
- Add `generateBlueWords(title, keywords)` — extract/inject trending blue words (clickable hashtags)
- Add `generateCommentGuide(brand, content)` — suggest first-comment text for engagement
- Add `generateABVariants(baseTitle, count)` — create A/B title variants
- Add `checkDedupHistory(orgId, content)` — check against past content to avoid repetition
- New schema `libs/mongodb/src/schemas/copy-history.schema.ts`:
  - `orgId`, `taskId`, `title`, `subtitle`, `hashtags[]`, `blueWords[]`, `commentGuide`
  - `performance` (views, clicks, ctr)
  - Index on `orgId` + `title` text index for dedup
- Add to barrel + register
- Update controller with new endpoints: `/copy/blue-words`, `/copy/comment-guide`, `/copy/ab-variants`

## Task 5: Data Dashboard API
Create `apps/aitoearn-server/src/core/mediaclaw/data-dashboard/` module:
- `data-dashboard.module.ts`
- `data-dashboard.service.ts`:
  - `getContentHealth(orgId)` — engagement rate, completion rate, publishing consistency
  - `getCompetitorBenchmark(orgId, industry)` — compare metrics vs industry average (stub)
  - `getColdStartRecommendations(orgId)` — suggestions for new accounts (content type, posting time, hashtags)
  - `exportReport(orgId, format, dateRange)` — generate CSV/JSON export data
- `data-dashboard.controller.ts` — `api/v1/data/health`, `/benchmark`, `/cold-start`, `/export`
- Register in `mediaclaw.module.ts`

## After ALL tasks:
1. `npx nx build aitoearn-server` — must pass
2. 5 atomic commits (one per task), push after each
3. Print "ALL SPRINT 4 TASKS COMPLETE" at end
