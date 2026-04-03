# Codex Task: AI 爆款发现逻辑补全

## 背景
PRD 要求 AI 驱动的爆款内容发现闭环，目前代码只有规则引擎骨架（viralScore 加权排序 + P90 筛选），关键链路全是 stub/空壳。

## 任务列表（按顺序执行，每个单独 commit）

### Task 1: TikHub 真实 HTTP 调用（替换 stub）
**文件**: `apps/aitoearn-server/src/core/mediaclaw/acquisition/tikhub.service.ts`

当前 `searchVideos()` 和 `getVideoDetail()` 返回 stub 假数据。改为真实 HTTP 调用：
- 读 `TIKHUB_API_KEY` 和 `TIKHUB_BASE_URL` 环境变量
- `searchVideos()`: 用 `fetch()` 调用已有的 `buildPlatformContract()` 返回的 URL/headers/body，解析响应，映射到 `SearchVideoSummary[]`
- `getVideoDetail()`: 同理，真实调用 detail endpoint
- `getSourceVideo()`: 真实调用 sourceByShareUrl endpoint
- 如果 TIKHUB_API_KEY 未配置，降级为当前 stub 行为（console.warn + 返回假数据），不 throw
- 每个平台的响应格式不同，需要为 douyin/xhs/kuaishou/bilibili 各写一个 `parseSearchResponse()` 适配器
- 参考 TikHub 文档中各平台的响应结构（contract 注释已经写好了）
- 添加 5s 超时 + 重试 1 次

**验证**: 如果没有 TIKHUB_API_KEY，应该 graceful 降级不报错。如果有 key，用 `curl` 手动调一个 endpoint 对比结果格式。

Commit: `feat(acquisition): implement real TikHub HTTP calls with graceful stub fallback`

### Task 2: scheduledDiscoveryScan 实际落库
**文件**: `apps/aitoearn-server/src/core/mediaclaw/discovery/discovery.service.ts`

当前 `scheduledDiscoveryScan()` 是空壳（只打 debug log）。改为：
1. 从 `Competitor` 表读所有 active 竞品账号
2. 按 platform 分组，对每组调 `TikHubService.searchVideos(platform, keyword)`（keyword = 竞品行业关键词）
3. 对返回结果计算 `viralScore`
4. Upsert 到 `ViralContent` 表（用 `platform + videoId` 作为唯一键，避免重复）
5. 如果某条内容的 viralScore >= P90 阈值，标记 `remixStatus = PENDING`
6. 记日志：扫描了多少竞品、发现了多少新内容、多少进入 P90

**验证**: 手动触发一次 scan（或把 cron 改成 EVERY_MINUTE 临时测一次），检查 MongoDB ViralContent 表有新数据。

Commit: `feat(discovery): implement scheduled scan with competitor-based keyword crawling`

### Task 3: Crawler Worker 实际处理 BullMQ Job
**文件**: `apps/aitoearn-server/src/core/mediaclaw/crawler/crawler.service.ts` + 新建 `crawler.processor.ts`

当前 `enqueueCrawl()` 把 job 入队但没有 processor 消费。新建 `CrawlProcessor`:
1. 注册为 `@Processor(MEDIACLAW_CRAWL_QUEUE)`
2. `@Process('crawl')` handler：
   - 从 job.data 取 platform/keyword/depth/route
   - 如果 route.mode === 'tikhub_only'：直接用 seedResults 作为最终结果
   - 如果 route.mode === 'tikhub_plus_media_crawler_pro'：seedResults + 打印 TODO log（MediaCrawlerPro 暂不实现）
   - 对每条结果调 `DiscoveryService.calculateViralScore()` 并 upsert 到 ViralContent
   - 更新 job progress 和 returnvalue
3. 注册到 discovery.module.ts

**验证**: POST /api/v1/crawler/enqueue，等 5s，GET /api/v1/crawler/:jobId/results 看到有数据。

Commit: `feat(crawler): add BullMQ processor to consume crawl jobs and persist viral content`

### Task 4: ContentRemixAgent 接口预埋
**文件**: 新建 `apps/aitoearn-server/src/core/mediaclaw/discovery/content-remix.service.ts`

PRD 要求 LLM 分析爆款元素并生成二创灵感。当前完全缺失。创建：
1. `ContentRemixService` 注入 ViralContent model
2. `analyzeViralElements(contentId)`: 
   - 读 ViralContent 记录
   - 构造 prompt："分析以下爆款视频的成功元素：标题、话题、节奏、情绪钩子、视觉风格"
   - 调 VCE Gemini API（`https://api.vectorengine.cn/v1/chat/completions`，model `gemini-3.1-pro-preview`，key 从 `VCE_GEMINI_API_KEY` env）
   - 解析响应，返回 `{ elements: string[], remixSuggestions: string[], confidence: number }`
   - 如果 API key 未配置，返回 stub 结果 + console.warn
3. `generateRemixBrief(contentId, brandId)`:
   - 调 analyzeViralElements 获得元素
   - 结合 Brand 的 tone/style 信息，生成二创 brief
   - 返回 `{ brief: string, estimatedViralScore: number, suggestedPlatforms: string[] }`
4. 注册到 discovery.module
5. 在 discovery.controller 加两个端点：
   - `POST /api/v1/discovery/:contentId/analyze` 
   - `POST /api/v1/discovery/:contentId/remix-brief`

**验证**: 调 /analyze endpoint，如果没 VCE key 返回 stub，有 key 返回真实分析。

Commit: `feat(discovery): add ContentRemixService with LLM-powered viral element analysis`

### Task 5: 端到端自检
跑完 Task 1-4 后：
1. `npx nx build aitoearn-server` 确认编译通过
2. 跑现有测试 `npx nx test aitoearn-server` 确认没 break
3. 检查所有新增文件都 import 正确、module 注册正确
4. 写一个简短的验收清单到 stdout

## 规则
- 提交前确保 build 通过、lint 无新 warning
- 每个改动单独 commit，用 Conventional Commits 格式
- 先定位 root cause 再改，不要跳过调查直接修
- 如果 TikHub API key 或 VCE API key 未配置，必须 graceful 降级，不能 throw
- 不要改不相关的文件（scope lock）
