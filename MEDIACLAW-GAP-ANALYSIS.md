# MediaClaw PRD v1.6 vs 代码实现 Gap Analysis

## 后端 (Codex 负责)

### ✅ 已实现
- [x] 多租户模型 (org, account, user schemas)
- [x] 品牌资产 CRUD (brand.schema + brand.service)
- [x] API Key 系统 (api-key.schema + apikey.service)
- [x] 审计日志 (audit-log.schema + audit.service)
- [x] Campaign 管理 (campaign.schema + campaign.service)
- [x] 竞品监控 (competitor.schema + competitor.service)
- [x] 计费系统 (billing + payment + credits + invoice schemas)
- [x] 视频管理 (video-task + pipeline schemas)
- [x] 文案引擎 (copy + copy-history schemas)
- [x] 通知系统 (notification schemas + service)
- [x] Webhook (webhook.schema + service)
- [x] 报告生成 (report.schema + service)
- [x] 数据看板 (data-dashboard + analytics services)
- [x] 内容管理 (content-mgmt service)
- [x] 任务管理 (task-mgmt service)
- [x] Health endpoint (/health OK)
- [x] Docker 配置 (Dockerfile + docker-compose.production.yml)
- [x] Deploy V2 脚本 (scripts/deploy.sh)
- [x] Crawler/采集 (crawler + tikhub service)
- [x] Marketplace (marketplace-template schema)
- [x] ClawHost 实例管理 (clawhost service)
- [x] Usage 追踪 (usage.service)
- [x] 素材版本 (brand-asset-version.schema)

### ❌ 缺失 / 需要完善（按 PRD Phase 排序）

#### Phase 0（P0 基建）
- [ ] **Docker 化部署实际完成** — docker-compose up 验证通过（Codex 正在做）
- [ ] **MediaClaw-FFmpeg-Base 镜像** — 含 libfreetype + Noto Sans CJK 的基础镜像
- [ ] CI/CD 流水线实际跑通

#### Phase 1a（P0 核心管线）
- [ ] **视频管线实际执行**：Python 脚本 → NestJS Worker 迁移（关键帧提取 → Gemini 帧编辑 → Kling i2v → FFmpeg 拼接 → 字幕渲染 → 去重）
- [ ] **OpenClaw Client Skill** — mediaclaw-client Skill for ClawHub
- [ ] **AI 深度合成标识**（水印 + 元数据标记）

#### Phase 1b（P1 API + 审批）
- [ ] **审批工作流逻辑**：多级审批（1/2/3级）+ 通知流转
- [ ] **文案引擎实际对接 LLM**（DeepSeek/Gemini，标题+字幕+标签+蓝词+评论引导词）
- [ ] **MediaClaw API v1 端点验证** — /v1/content, /v1/account, /v1/brand 全部可用
- [ ] **视频包购买流程** — 微信/支付宝 QR 支付

#### Phase 2（P1 数据+企业）
- [ ] 数据采集 Worker 实际运行
- [ ] 效果数据回收（截图 OCR + MediaCrawler）
- [ ] 内容日历拖拽排期（前端功能）
- [ ] 批量操作 API
- [ ] 数据导出 CSV/PDF
- [ ] 推送系统（Gateway API + heartbeat）

## 前端 (Gemini 负责)

### ✅ 已实现
- [x] auth 登录页 (SMS)
- [x] dashboard 总览
- [x] analytics 数据分析
- [x] billing 计费页
- [x] brands 品牌管理
- [x] calendar 内容日历
- [x] campaigns 活动管理
- [x] onboarding 引导
- [x] settings 设置
- [x] subscription 订阅
- [x] videos 视频列表+详情
- [x] pricing 定价页
- [x] admin 管理后台
- [x] 全局搜索、通知中心、错误边界

### ❌ 需要修复 / 完善
- [ ] **Build 修复** — calendar/page.tsx setView error（Gemini 正在修）
- [ ] **API 实际对接** — 所有页面用 mock 数据，需对接 http://8.129.133.52/api/v1
- [ ] **视频生产流程页面** — 上传素材 → 选品牌 → 下单 → 进度追踪 → 预览
- [ ] **审批界面** — 视频预览+通过/驳回+留言+审核历史
- [ ] **支付流程** — QR 码支付 + 订单状态轮询
- [ ] **微信 OAuth 登录** — 真实对接
- [ ] **WebSocket 实时推送** — 视频生成进度实时更新
- [ ] **响应式适配** — 移动端 375px 测试
- [ ] **暗色模式一致性检查**

## 任务分工

### Codex（后端）优先级：
1. Docker 化部署完成
2. 视频管线 Worker（核心差异化）
3. 文案引擎 LLM 对接
4. 审批工作流逻辑
5. API 端点补全

### Gemini（前端）优先级：
1. Build 修复
2. API 对接层
3. 视频生产流程页面
4. 审批界面
5. 支付流程
