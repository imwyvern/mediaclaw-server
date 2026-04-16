# Codex Task: Bridge MediaClaw Tools to Real Server Services

## 项目
`/Volumes/External/mac-offload/projects/mediaclaw/server/project/aitoearn-backend`

## 背景
`libs/mediaclaw-tools-*` 有 23 个 Tool 函数（纯函数），目前用 mock/placeholder 逻辑。
`apps/aitoearn-server/src/core/mediaclaw/` 有完整的真实 API 对接代码（NestJS services）。

需要让 Tool 函数调用真实 API，参考 `aitoearn-server` 里已有的调用方式。

## 已有的真实 API 服务映射

| Tool | 真实服务 | 文件 |
|------|---------|------|
| videoDownload | TikHubService | `acquisition/tikhub.service.ts` |
| sceneCutter | ffmpeg runCommand | `pipeline/pipeline.utils.ts` |
| motionAnalyzer | Gemini API | `apps/aitoearn-ai/src/core/ai/libs/gemini/` |
| brandReplacer | BrandEditService | `pipeline/brand-edit.service.ts` |
| videoGenerator | VideoGenService | `pipeline/video-gen.service.ts` |
| scriptWriter | Gemini/DeepSeek | `copy/copy.service.ts` |
| ttsEngine | TtsService (MiniMax) | `pipeline/tts.service.ts` |
| videoAssembler | ffmpeg | `pipeline/video-gen.service.ts` (composeSegments) |
| finalComposer | ffmpeg | `pipeline/pipeline.service.ts` |
| qaOptimizer | QualityCheckService | `pipeline/quality-check.service.ts` |
| dedupGatekeeper | DedupService | `pipeline/dedup.service.ts` |
| contentReviewer | Gemini | review prompt |
| trendingScout | TikHubService.searchVideos | `acquisition/tikhub.service.ts` |
| contentPlanner | Gemini | LLM 调用 |
| remixBrief | Gemini | LLM 分析 |
| performanceInsight | AnalyticsService | `analytics/analytics.service.ts` |
| platformPackager | SubtitleService + CopyService | `pipeline/subtitle.service.ts` |
| shotUpgrader | VideoGenService | `pipeline/video-gen.service.ts` |
| styleRewriter | PipelineStyleRewriteService | `pipeline/pipeline-style-rewrite.service.ts` |
| videoEditor | PipelineService | `pipeline/pipeline.service.ts` |

## 步骤

### 1. 更新 videoDownload (libs/mediaclaw-tools-ingest/src/video-download.ts)
参考 `apps/aitoearn-server/src/core/mediaclaw/acquisition/tikhub.service.ts`:
- 使用 TikHub API: `GET /api/v1/douyin/web/fetch_one_video_by_share_url`
- API Key: `process.env.TIKHUB_API_KEY`
- Base URL: `process.env.TIKHUB_BASE_URL || 'https://api.tikhub.io'`
- 下载视频到 `MEDIA_TEMP_DIR`

### 2. 更新 videoGenerator (libs/mediaclaw-tools-generation/src/video-generator.ts)
参考 `apps/aitoearn-server/src/core/mediaclaw/pipeline/video-gen.service.ts`:
- Kling API: `POST {baseUrl}/kling/v1/videos/omni-video`
- 轮询: `GET {baseUrl}/kling/v1/videos/omni-video/{taskId}`
- API Key: `process.env.SEEDANCE_API_KEY`
- Base URL: `process.env.VCE_BASE_URL || 'https://api.vectorengine.ai'`
- Model: `kling-v3-omni`
- image 用 base64 编码

### 3. 更新 scriptWriter (libs/mediaclaw-tools-audio-text/src/script-writer.ts)
参考 `apps/aitoearn-server/src/core/mediaclaw/copy/copy.service.ts`:
- Gemini API: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
- 或 DeepSeek: `POST https://api.deepseek.com/chat/completions`
- 返回 JSON 格式的 lines 数组

### 4. 更新 ttsEngine (libs/mediaclaw-tools-audio-text/src/tts-engine.ts)
参考 `apps/aitoearn-server/src/core/mediaclaw/pipeline/tts.service.ts`:
- MiniMax TTS API: `POST {baseUrl}/v1/t2a_v2`
- API Key: `process.env.MINIMAX_API_KEY`
- Voice IDs: Chinese_Female_Gentle, Chinese_Male_Warm, Chinese_Female_Energetic
- 返回 audio buffer

### 5. 更新 brandReplacer (libs/mediaclaw-tools-branding/src/brand-replacer.ts)
参考 `apps/aitoearn-server/src/core/mediaclaw/pipeline/brand-edit.service.ts`:
- VectorEngine Image API: `POST {baseUrl}/flux/v1/generations`
- 发送 base64 图片 + inpaint prompt
- 下载结果图片

### 6. 更新 trendingScout (libs/mediaclaw-tools-intelligence/src/trending-scout.ts)
参考 `apps/aitoearn-server/src/core/mediaclaw/acquisition/tikhub.service.ts`:
- TikHub 搜索 API
- 适配各平台（douyin/xhs/kuaishou/bilibili）

### 7. 更新 performanceInsight (libs/mediaclaw-tools-intelligence/src/performance-insight.ts)
参考 `apps/aitoearn-server/src/core/mediaclaw/analytics/analytics.service.ts`:
- 效果追踪和月度报告
- Gemini 生成诊断

### 8. 更新环境变量
在 `.env.production.example` 中补充：
```
MINIMAX_API_KEY=
MINIMAX_TTS_BASE_URL=https://api.minimax.chat
DEEPSEEK_API_KEY=
KLING_BASE_URL=https://api.vectorengine.ai
```

## 要求
- 保持 Tool 函数为纯函数（不依赖 NestJS DI）
- 所有外部 API 调用通过 `fetch` 或 `node:https`
- API Key 和 Base URL 从 `process.env` 读取
- 错误处理：API 调用失败时返回 `meta.retryable = true`
- 保持现有测试通过（测试 mock 了 fetch）
- 每个 tool 更新单独 commit，Conventional Commits 格式
- Build 通过: `npx nx build aitoearn-ai`
- 所有 lib 测试通过
