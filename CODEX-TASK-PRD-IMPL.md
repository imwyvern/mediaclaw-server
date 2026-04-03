# Codex 持续开发任务 — 对齐 PRD v1.6

## 优先级 1: 视频管线 Worker (Phase 1a 核心)

PRD Section 5.1.1 定义的完整管线：

```
参考视频 → 关键帧提取(ffmpeg, 3帧) → Gemini帧编辑(VCE API) → Kling V3 i2v → FFmpeg拼接 → Pillow字幕渲染 → 去重处理 → 成品输出
```

在 `apps/aitoearn-server/src/core/mediaclaw/pipeline/` 下实现：
1. `pipeline.service.ts` — 主管线编排
2. `frame-extract.service.ts` — ffmpeg 关键帧提取
3. `brand-edit.service.ts` — Gemini 帧编辑 (VCE API: api.vectorengine.cn)
4. `video-gen.service.ts` — Kling V3 i2v (api.vectorengine.ai, model: kling-v3-omni)
5. `subtitle.service.ts` — Pillow/FFmpeg 字幕渲染
6. `dedup.service.ts` — 6层去重(prompt变异/色调/速度/裁切/字幕样式/指纹扰动)
7. `quality-check.service.ts` — 自动质检(分辨率≥720p, 时长±2s, 文件>500KB)

BullMQ queue: `mediaclaw_crawl` (已有) + 新建 `mediaclaw_pipeline`

## 优先级 2: 文案引擎 LLM 对接 (Section 5.2)

`apps/aitoearn-server/src/core/mediaclaw/copy/`:
- copy-engine.service.ts — 对接 DeepSeek/Gemini
- 输出: 标题(≤60字) + 字幕(15-60字) + 话题标签(5-10个) + 蓝词 + 评论引导词(3条)
- 去重: 维护历史文案库

## 优先级 3: 审批工作流 (Section 5.8.1)

`apps/aitoearn-server/src/core/mediaclaw/content-mgmt/`:
- 多级审批逻辑 (1/2/3级, 按套餐)
- 审批状态机: draft → pending_review → approved / rejected → published
- 通知集成: 审批状态变更 → 通知相关人

## 优先级 4: API 端点补全验证 (Section 5.6.3)

验证以下端点都可用:
- GET /v1/content (列表+分页+状态筛选)
- GET /v1/content/:id (详情含视频URL+文案)
- POST /v1/content/:id/approve (审核通过)
- POST /v1/content/:id/published (标记已发布)
- PATCH /v1/content/:id/copy (修改文案)
- GET /v1/analytics/overview
- GET /v1/analytics/trends
- POST /v1/tasks (创建生产任务)
- GET /v1/account
- GET /v1/account/usage

## 优先级 5: OpenClaw Client Skill

创建 `libs/mediaclaw-skill/` 或独立仓库:
- SKILL.md (AgentSkills 兼容格式)
- mc-api.sh (API 调用脚本)
- Few-shot 对话示例
- 上架 ClawHub

## 规则
- 每个功能模块单独 commit (Conventional Commits)
- 提交前 build 通过
- 新模块必须有基本单元测试
- 不在服务器上 build
- 读 PRD 详细内容: /Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v1.5.md
- Gap Analysis: /Users/wes/projects/mediaclaw/server/MEDIACLAW-GAP-ANALYSIS.md
