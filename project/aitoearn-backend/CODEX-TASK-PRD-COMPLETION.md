# MediaClaw PRD 补完：全模块开发 + 自检

> **目标**：按 PRD v2.0 逐个补完所有未达标模块，每完成一个模块做一轮自检 review，直到代码与 PRD 一致。
> **执行方式**：按 Phase 顺序依次完成，每个 Task 完成后自检再继续下一个。
> **参考文档**：`/Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v2.0.md`

---

## 规则

1. 每个改动单独 commit，`type(scope): description` 格式
2. 每个 Task 完成后：`npm run build` + `npm run lint` + `npm test`
3. 发现后端 API 缺失 → 先补后端再接前端
4. 不要引入新 mock/fallback/静态假数据
5. 100 行以上改动自审一轮再继续

---

## 路径说明

- **后端代码**：当前目录 `/Users/wes/projects/mediaclaw/server/project/aitoearn-backend/`
  - 后端模块：`apps/aitoearn-server/src/core/mediaclaw/`
  - AI 模块：`apps/aitoearn-ai/src/core/`
  - 共享库：`libs/`
- **前端代码**：`/Users/wes/projects/mediaclaw/web/src/`
- **PRD**：`/Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v2.0.md`

---

## Phase 1: 后端模块补完

当前后端已有 40+ 个模块目录，大部分有 CRUD 骨架。以下模块需要补完业务逻辑使其达到 PRD 要求。

**每个 Task 的通用自检项：**
- controller 有完整的 CRUD + 业务端点
- service 有真实业务逻辑（不只是 CRUD pass-through）
- DTO 有验证（class-validator）
- 错误处理覆盖 401/402/403/404/429/500
- orgId scope 隔离
- 有基本单元测试

### Task 1: 智能文案引擎 `copy/`
**PRD 5.2 对标：**
- 多风格文案生成（种草/测评/促销/品牌故事）
- 蓝词策略（SEO 关键词自然植入到标题/描述）
- A/B 变体生成（同一视频生成 2-3 套不同风格文案）
- 评论引导词（引导用户互动的评论模板）
- 去重历史库（防止同一品牌生成重复文案）
- 品牌关键词注入 + 禁用词过滤
**验收**：给定视频 ID + 品牌配置，能生成包含标题/描述/标签/评论引导的完整文案套件

### Task 2: 内容分发引擎 `distribution/` + `employee-dispatch/`
**PRD 5.3 对标：**
- 分发规则引擎（按员工/平台/时段维度路由）
- 发布状态机：completed → pushed → published → expired
- 员工回调收集（发布后回传作品链接 + 平台 post_id）
- 48h 未处理自动提醒
- Gateway API 推送 + heartbeat 轮询双通道
**验收**：视频生产完 → 按规则推到员工 → 员工确认发布 → 状态更新 → 数据回流

### Task 3: 管线系统 `pipeline/` + `pipeline-system/`
**PRD 5.3.5 对标：**
- 管线 CRUD（名称/风格/平台/分发规则）
- 5 个预置模板（种草线/测评线/新品宣传线/品牌故事线/促销线）
- 管线偏好学习（按优先级：老板反馈 > 运营反馈 > 效果数据 > 拒绝原因）
- 管线绑定到 IM 群
- 管线预热（首次使用前试生产一批）
**验收**：能创建管线 → 选模板 → 配分发规则 → 绑群 → 偏好自动调整

### Task 4: 全域数据中台 `analytics/` + `data-dashboard/`
**PRD 5.4 对标：**
- 效果总览（播放/互动/粉丝，支持 7d/30d/90d 周期）
- 单条内容效果追踪
- 趋势分析（按天/周/月聚合）
- TOP N 内容排名（按播放/互动/转化等指标）
- 蓝词 SEO 排名变化
- 报告生成（异步生成 PDF/Markdown）
- 数据飞轮：效果数据 → 偏好学习 → 优化下一轮生产
**验收**：API 返回真实聚合数据，报告能正常生成

### Task 5: 爆款追踪引擎 `competitor/` + `discovery/` + `crawler/`
**PRD 5.7 对标：**
- 行业关键词采集 → viral_score 评分 → P90 过滤 → 推荐池
- ContentRemixAgent 5 维分析（结构/节奏/画面/文案/音乐）
- 竞品列表管理（添加/删除/查看）
- 竞品热门内容聚合
**验收**：能添加竞品 → 系统抓取热门 → viral_score 有计算逻辑 → 能推荐

### Task 6: 支付系统闭环 `payment/` + `billing/`
**PRD 5.8 + 5.10 对标：**
- XorPay 微信/支付宝真实支付闭环
- 订单创建 → 跳转支付 → 回调验签 → 额度充值
- 发票管理
- 套餐升级/续费
- 对账 Job（定时核对支付与额度）
- 试用包（注册送 1 条免费）
**验收**：前端下单 → 生成支付链接 → 回调更新 → 额度可用

### Task 7: ToB 企业功能 `org/` + `client-mgmt/` + `audit/`
**PRD 5.9 对标：**
- 企业组织 CRUD + 组织信息管理
- 成员邀请/角色分配/权限管理
- 审计日志（90 天 TTL，可导出 CSV/JSON）
- 素材版本管理
- 批量操作（批量编辑文案/批量下载/批量删除）
**验收**：能创建企业 → 邀请成员 → 分配角色 → 操作留痕 → 审计可查

### Task 8: Webhook 集成 `webhook/`
**PRD 对标：**
- Webhook 注册/管理（URL + events + secret）
- 事件触发（视频完成/支付成功/发布回调/额度不足）
- HMAC-SHA256 签名验证
- 失败重试（指数退避，最多 5 次）
- 飞书/钉钉/企微 Webhook 适配器
**验收**：注册 webhook → 触发事件 → 收到回调 → 重试正常

### Task 9: OpenClaw Skill 接入 `skill/` + `libs/mediaclaw-skill/`
**PRD 5.6 对标：**
- mediaclaw-client Skill 完整实现
- L1 视频下单（创建任务/查进度/预览/下载）
- L2 品牌管理（查看/更新配置/上传素材/查余额）
- L3 数据查询（效果总览/趋势/TOP N/竞品）
- L4 管线管理（创建/配置/绑群/Campaign）
- Agent 注册和能力发现
**验收**：OpenClaw 装 skill 后能通过对话完成全流程

---

## Phase 2: 前端接通真实 API

前端代码在 `/Users/wes/projects/mediaclaw/web/src/`。

上一轮已经消灭了大部分 mock，但还剩少量。逐一验证每个 Dashboard 页面都接通了后端真实 API。

### Task 10: 验证所有 Dashboard 页面无 mock
扫描 `src/` 目录，确认：
- 无 `MOCK_*` 常量
- 无 `Math.random()` 生成数据
- 无 `Fallback mock` 注释
- 无 `simulateConnection()`
- 无 `setTimeout` 模拟异步

如果发现残留 mock → 接通对应后端 API → 删除 mock 代码。

页面清单：
- `dashboard/page.tsx` — 主看板
- `dashboard/content/page.tsx` — 内容列表
- `dashboard/videos/page.tsx` — 视频列表
- `dashboard/brands/page.tsx` — 品牌管理
- `dashboard/campaigns/page.tsx` — Campaign
- `dashboard/analytics/page.tsx` — 数据分析
- `dashboard/billing/page.tsx` — 计费
- `dashboard/calendar/page.tsx` — 日历
- `dashboard/settings/page.tsx` — 设置
- `components/notification-center.tsx` — 通知
- `lib/ws.ts` — WebSocket

### Task 11: 前端 build 验证
- `cd /Users/wes/projects/mediaclaw/web && npm run build`
- 确认无编译错误
- 确认无 TypeScript 类型错误

---

## Phase 3: v2.0 新功能

DEVPLAN 中明确标了 `[ ]` 的 v2.0 新特性。

### Task 12: Template-driven Pipeline Architecture
- `templates/` 目录，标准 `run(params) → result` 接口
- b7-ai-live 模板（AI 微动效，5min/video）
- b9-product-showcase 模板（参考视频复刻，20min/video）

### Task 13: Style Rewrite Engine
- Gemini visual differentiation
- 布局不变 + 材质/色调/光影随机变异
- 确保同一参考视频每次生成不同视觉风格

### Task 14: Account Routing System
- 账号类型 → 模板绑定 → 每日配额 → 单账号覆盖
- 支持多账号分发管理

### Task 15: Vector Dedup System
- Milvus HNSW COSINE + doubao-embedding-vision + AI judge
- 生产后批量查重，只放行通过的
- docker-compose 加 Milvus 服务

### Task 16: Production Orchestrator
- daily_dispatch：每日定时触发生产任务
- checkpoint resume：中断后可恢复
- batch_id tracking：批次追踪
- summary reports：每日生产报告

### Task 17: TikHub → NestJS Service
- 把 tikhub-api-kit 封装成 NestJS Service
- 统一 ContentProvider interface
- 作为 adapter/fallback，不绑死主系统

---

## Phase 4: AI 服务补完

### Task 18: AI Agent 编排 `apps/aitoearn-ai/src/core/agent/`
- 多 Agent 角色（策划/生产/分发/分析）
- Agent 注册中心
- 工具调用层
- 记忆层
- 工作流策略编排

### Task 19: Draft Generation `apps/aitoearn-ai/src/core/draft-generation/`
- 与文案引擎 v2 对接
- 多模型支持（DeepSeek/Gemini）

### Task 20: Material Adaptation `apps/aitoearn-ai/src/core/material-adaptation/`
- 与品牌资产系统对接
- 自动适配不同管线风格

---

## 自检 Checklist（每个 Task 完成后执行）

```
1. npm run build — 编译通过？
2. npm run lint — 无新 warning？
3. npm test — 无新 failure？
4. 对照 PRD 对应章节 — 功能点逐项 check
5. orgId scope 隔离 — 跨组织查不到数据？
6. 错误处理 — 401/403/404 有合理响应？
7. commit — 每个改动单独 commit，conventional commits
```

---

## 执行顺序

Phase 1（后端补完 Task 1-9）→ Phase 2（前端验证 Task 10-11）→ Phase 3（v2.0 新功能 Task 12-17）→ Phase 4（AI 服务 Task 18-20）

从 Task 1 开始，逐个执行，每完成一个自检后继续下一个。
