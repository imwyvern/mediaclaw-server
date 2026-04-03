# Codex Task: 消灭所有 stub/mock/hardcode — 全部接真实数据

## 目标
把后端所有返回 stub/mock/hardcoded 数据的地方替换为真实 MongoDB 查询或真实外部 API 调用。
**零 stub 容忍** — 如果外部 API key 没配，返回 `{ status: 'unavailable', reason: 'API key not configured' }` 而不是假数据。

## 原则
- 每个模块一个 commit，Conventional Commits 格式
- 提交前确保 `npx nx build aitoearn-server` 通过
- 不改 `usage.service.ts` 的 `chargeVideo` 方法
- 不改 `clawhost/` 目录（依赖 K8s，保持 stub）
- 不改 `auth/` 目录

## 模块清单

### 1. tikhub.service.ts — 5 处 stub return
文件: `apps/aitoearn-server/src/core/mediaclaw/acquisition/tikhub.service.ts`
行号: 95, 131, 158, 197, 1105

当前问题：没配 `TIKHUB_API_KEY` 时返回 `source: 'stub'` 的假数据（假播放量、假视频列表等）。

修改：
- 没有 `TIKHUB_API_KEY` 时，所有方法返回：
```typescript
{ success: false, data: null, source: 'unavailable', reason: 'TIKHUB_API_KEY not configured' }
```
- 有 key 时保持现有真实 API 调用不变
- `trackPerformance` (行 150-165)：当前是纯 stub，改为调用 TikHub 的视频详情 API 获取真实效果数据：
  - 抖音: GET `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video_by_share_url`
  - 小红书: GET `https://api.tikhub.io/api/v1/xiaohongshu/app_v2/get_note_info_v3`
  - 按 videoId 格式或 platform 字段判断调哪个端点
  - 返回真实的 views/likes/comments/shares

### 2. data-dashboard.service.ts — 竞品对标硬编码 + 冷启动假推荐
文件: `apps/aitoearn-server/src/core/mediaclaw/data-dashboard/data-dashboard.service.ts`

**getCompetitorBenchmark** (行 95)：
- 当前：返回硬编码行业 baseline 数字
- 改为：从 `viral_contents` collection 聚合该行业的真实数据（平均播放量、互动率、发布频率）
- 如果该行业数据不足（<10 条），返回 `{ data: null, reason: 'insufficient_data', minRequired: 10, currentCount: N }`

**getColdStartRecommendations** (行 144)：
- 当前：没有数据时返回固定的内容类型、发帖时段、hashtag
- 改为：从 `viral_contents` 聚合热门内容类型和最佳发布时间
- 如果库里没有足够数据，返回 `{ recommendations: [], reason: 'insufficient_data' }` 而非假推荐

**getIndustryBenchmark** (行 574)：
- 当前：可能返回硬编码 baseline
- 改为：从 `video_analytics` + `viral_contents` 聚合真实行业指标
- 按 `organization.industry` 分组聚合

### 3. content-remix.service.ts — AI 分析 fallback
文件: `apps/aitoearn-server/src/core/mediaclaw/discovery/content-remix.service.ts`

当前：没配 `VCE_GEMINI_API_KEY` 时返回 `source: 'stub', model: 'stub'` 的假分析结果。

修改：
- 没有 API key 时返回：
```typescript
{ success: false, analysis: null, source: 'unavailable', reason: 'VCE_GEMINI_API_KEY not configured' }
```
- 删掉所有 `source: 'stub'` 的假数据生成代码
- 有 key 时保持现有 VCE Gemini 调用不变（URL: `https://api.vectorengine.cn/v1/chat/completions`, model: `gemini-3.1-pro-preview`）

### 4. pipeline/brand-edit.service.ts — mock 模式
文件: `apps/aitoearn-server/src/core/mediaclaw/pipeline/brand-edit.service.ts`

当前：`provider === 'mock'` 时生成假的编辑结果。

修改：
- 删掉 mock provider 分支
- 没有 API key 时返回 `{ status: 'skipped', reason: 'no_api_key', originalFrameUsed: true }`
- 不再生成任何假的 "编辑后" URL 或假数据

### 5. pipeline/video-gen.service.ts — mock 片段生成
文件: `apps/aitoearn-server/src/core/mediaclaw/pipeline/video-gen.service.ts`

当前：`provider === 'mock'` 时生成本地 mock 视频片段。

修改：
- 删掉 mock provider 分支和本地 mock 片段生成代码
- 没有 API key 时返回 `{ status: 'skipped', reason: 'no_api_key' }`
- 有 key 时保持现有 Kling V3 API 调用不变（URL: `https://api.vectorengine.ai`）

### 6. analytics — 完善聚合查询
文件:
- `apps/aitoearn-server/src/core/mediaclaw/analytics/analytics.service.ts`
- `apps/aitoearn-server/src/core/mediaclaw/analytics/analytics-collector.service.ts`

当前：`task_snapshot` fallback 从 video_tasks 的嵌套字段读取，不是独立时序数据。

修改：
- `analytics.service.ts` 的 overview 聚合优先从 `video_analytics` collection 查询
- 如果 `video_analytics` 为空，返回 `{ data: null, reason: 'no_analytics_data', hint: 'Configure TIKHUB_API_KEY to enable automatic data collection' }` 而不是从 task_snapshot fallback
- `analytics-collector.service.ts` 的采集逻辑：确保调用 `tikhub.service.trackPerformance()` 获取真实数据写入 `video_analytics`

### 7. payment/xorpay.service.ts — mock 支付
文件: `apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service.ts`

当前：有 mock 支付模式（返回 `xorpay://mock/` URL）。

修改：
- **保留 mock 支付模式**但改名为 `sandbox` 模式
- `gateway.mock` 改为 `gateway.sandbox`
- mock URL 改为 `xorpay://sandbox/${order.orderId}`
- 日志明确标记 `[SANDBOX MODE]`
- 这是测试用的合理设计，不是 stub，只是命名不清晰

## 环境变量参考
- `TIKHUB_API_KEY` → TikHub at `https://api.tikhub.io`
- `VCE_GEMINI_API_KEY` → Gemini at `https://api.vectorengine.cn/v1/chat/completions` (model: `gemini-3.1-pro-preview`)
- `KLING_API_KEY` → Kling V3 at `https://api.vectorengine.ai`

## MongoDB Collections 参考
- `video_analytics` — 效果数据时序表（schema 在 `libs/mongodb/src/schemas/video-analytics.schema.ts`）
- `viral_contents` — 爆款内容库
- `video_tasks` — 视频任务（含嵌套 analytics_snapshot）
- `organizations` — 组织信息（含 industry 字段）

## 验收标准
1. `grep -rn "source.*stub" apps/aitoearn-server/src/core/mediaclaw/ --include="*.ts" | grep -v ".spec." | grep -v clawhost` 输出为空
2. `npx nx build aitoearn-server` 通过
3. 没有 API key 时返回结构化的 unavailable 响应，不返回假数据
