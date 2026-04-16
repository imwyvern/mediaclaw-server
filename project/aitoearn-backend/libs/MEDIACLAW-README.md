# MediaClaw 视频工厂

AI 驱动的短视频批量生产管线，基于 NestJS + Nx monorepo 架构。

## 架构

```
libs/
  mediaclaw-shared-kernel     # 状态机、类型、合约
  mediaclaw-agent-runtime     # 决策引擎 + 管线 Runner
  mediaclaw-tools-ingest      # 视频下载、切割、运镜分析
  mediaclaw-tools-branding    # 品牌替换、验证
  mediaclaw-tools-generation  # 视频生成 (Kling V3)
  mediaclaw-tools-audio-text  # 文案生成、TTS 配音
  mediaclaw-tools-compose     # 视频拼接、最终合成
  mediaclaw-tools-quality     # QA、查重、合规审核
  mediaclaw-tools-intelligence # 趋势发现、效果分析、内容策划
  mediaclaw-tools-platform    # 平台包装、Remotion 渲染
  mediaclaw-tools-strategy    # 镜头升级、风格改写、视频编辑

apps/aitoearn-ai/src/core/mediaclaw/
  mediaclaw.module.ts          # NestJS 模块
  mediaclaw.controller.ts      # REST API 端点
  mediaclaw.service.ts         # 管线编排
  mediaclaw.processor.ts       # Bull Queue Worker
```

## 管线类型

| 管线 | 步骤 | 用途 |
|------|------|------|
| product-showcase | 12 步 | 种草视频：下载→切割→运镜→品牌替换→AI生成→文案→TTS→合成→QA |
| ai-live | 4 步 | 产品图→微动视频 |
| explainer | 5 步 | Remotion模板→文案→TTS→合成 |

## API 对接

| Tool | API | 用途 |
|------|-----|------|
| videoDownload | TikHub | 4 平台视频下载 (douyin/xhs/kuaishou/bilibili) |
| videoGenerator | Kling V3 / VCE | i2v 视频生成 |
| brandReplacer | VCE Gemini Image Edit | 品牌替换 |
| scriptWriter | DeepSeek > Gemini > OpenAI | 文案生成 |
| ttsEngine | MiniMax > Volcengine | TTS 配音 |
| trendingScout | TikHub | 趋势搜索 |
| performanceInsight | TikHub + AI | 效果分析 |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.production.example .env

# 3. 启动基础设施
docker compose -f ../../docker-compose.mediaclaw.yml up -d

# 4. 运行
npx nx serve aitoearn-ai

# 5. 测试
npx nx run-many --target=test --all
```

## 环境变量

必须配置：
- `TIKHUB_API_KEY` — 视频下载 + 趋势搜索
- `SEEDANCE_API_KEY` — Kling V3 视频生成
- `VCE_API_KEY` — Gemini 品牌替换

可选：
- `MEDIACLAW_DEEPSEEK_API_KEY` — 文案生成 (可用 VCE Gemini 代理)
- `MINIMAX_API_KEY` — TTS 配音
- `GEMINI_API_KEY` — 备用 LLM

## 测试

```bash
# 全量测试
npx nx run-many --target=test --all

# 单个 lib
npx nx test mediaclaw-tools-ingest

# Build
npx nx build aitoearn-ai
```
