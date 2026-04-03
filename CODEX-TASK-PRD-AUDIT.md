# Codex Task: PRD v2.0 全面审计

## 目标
对照 PRD v2.0 文档 (`/Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v2.0.md`)，逐章检查代码实现的完成度。
输出一份详细的审计报告，明确标注每个功能点的状态：✅ 已实现 / ⚠️ 部分实现 / ❌ 未实现。

## 审计范围

### 后端代码
- `apps/aitoearn-server/src/core/mediaclaw/` — 所有模块
- `libs/` — 共享库

### 前端代码
- `/Users/wes/projects/mediaclaw/web/src/` — 所有页面和组件

## 审计步骤

### Step 1: 读 PRD v2.0
完整读取 `/Users/wes/clawd/mediaclaw/docs/MediaClaw-PRD-v2.0.md`，提取所有功能需求点，按章节分组。

### Step 2: 逐章对照代码
对每个 PRD 章节中的功能需求：
1. 在代码中搜索对应的 service/controller/module/page
2. 检查是否有完整实现（不只是骨架/stub）
3. 检查 API endpoint 是否暴露并注册到 module
4. 检查前端页面是否对接了对应 API

### Step 3: 输出审计报告
写到 `/Users/wes/projects/mediaclaw/server/PRD-AUDIT-REPORT.md`，格式：

```markdown
# PRD v2.0 审计报告
更新时间：YYYY-MM-DD

## 总览
- 已实现: X/Y (Z%)
- 部分实现: A/Y
- 未实现: B/Y

## 按章节

### Chapter X: 章节名
| 功能点 | 状态 | 对应代码 | 备注 |
|---|---|---|---|
| xxx | ✅/⚠️/❌ | 文件路径 | 说明 |

### 关键遗漏 TOP 10
按业务优先级排序，列出最影响上线的 10 个遗漏。
每个遗漏给出：
1. PRD 原文引用
2. 当前代码状态
3. 预估工作量（小/中/大）
4. 建议优先级（P0/P1/P2）
```

## 规则
- 只读不改，这是审计任务
- 骨架/stub/TODO 算"部分实现"，不算"已实现"
- 只有完整功能逻辑+API暴露+无 TODO 才算"已实现"
- 前端页面存在但没对接 API 算"部分实现"
- 输出要具体到文件路径和行号，不要笼统描述
- 完成后 print 报告摘要到 stdout
