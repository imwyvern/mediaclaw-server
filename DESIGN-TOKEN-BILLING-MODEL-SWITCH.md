# 设计方案：对话 Token 计费 + 模型切换

## 背景

MediaClaw 是 Agent-First 架构 — 用户通过 AI 对话完成大部分操作（下单、查数据、审核）。
当前问题：
1. 日常对话的 Token 消耗没有计费规则
2. 用户无法选择/切换大模型
3. Token 消耗对用户不透明

## 设计原则

1. **对话是核心体验，不能因收费阻碍使用**
2. **成本透明，但不制造焦虑**（用户能看到消耗，但不会因为怕花钱而不敢问问题）
3. **分层递进**（V1.0 简单，V2.0 精细）
4. **BYOK 用户完全自主**

---

## 方案一：对话 Token 计费

### V1.0 策略：订阅含量 + 透明追踪

```
套餐           月含对话量        超额
─────────────────────────────────────
启航 ¥2,980    50K tokens/月     暂不收费（soft limit 警告）
增长 ¥6,800    200K tokens/月    暂不收费（soft limit 警告）
专业 ¥14,800   500K tokens/月    暂不收费（soft limit 警告）
企业 ¥28,800   2M tokens/月      暂不收费（soft limit 警告）
BYOK           无限（用自己Key）  ¥0
```

**V1.0 不硬性收费的理由：**
- DeepSeek V3 成本 ~¥1/百万 token，50K tokens ≈ ¥0.05，成本可忽略
- Agent-First 核心体验不能被 token 焦虑破坏
- 先积累数据，V2.0 再根据真实用量定精确价格

**透明追踪（必须实现）：**
- 每次对话记录 inputTokens + outputTokens + model + cost
- Dashboard 显示：本月对话用量 / 含量百分比 / 各模型用量分布
- 接近 80% 含量时站内通知提醒
- 超过 100% 时提示"本月对话量已用完，建议升级套餐"但不阻断

### 数据模型

```typescript
// 新增 ConversationUsage（对话级追踪）
{
  orgId: ObjectId,
  userId: ObjectId,
  sessionId: string,          // OpenClaw session id
  model: string,              // 'deepseek-v3' | 'gpt-4o' | 'claude-sonnet'
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  estimatedCost: number,      // 按模型单价估算，单位：分
  intent: string,             // 'chat' | 'order' | 'query' | 'review'
  createdAt: Date,
}

// Organization 扩展
{
  monthlyTokenQuota: number,  // 月含量（根据套餐）
  currentMonthTokens: number, // 本月已用
  tokenQuotaResetDay: number, // 重置日（默认1号）
}
```

### API

```
GET  /api/v1/usage/conversation-summary   → 本月对话 token 汇总
GET  /api/v1/usage/conversation-detail     → 对话明细列表（分页）
GET  /api/v1/usage/model-breakdown         → 各模型用量分布
POST /api/v1/usage/track-conversation      → 记录一次对话消耗（Skill 调用）
```

---

## 方案二：模型切换

### 模型分类

```
类别          默认模型           可选模型              场景
──────────────────────────────────────────────────────────
对话          DeepSeek V3        GPT-4o / Claude      日常交互
文案          DeepSeek V3        Gemini Pro           视频文案生成
帧编辑        Gemini Flash       Gemini Pro           参考帧编辑
视频生成      Kling V3           Seedance / Runway    i2v 生成
分析          DeepSeek V3        GPT-4o               爆款拆解
```

### 切换规则

1. **企业级设置**（Admin 在 Settings 里配）— 全企业生效
2. **管线级覆盖**（可选）— 特定管线用特定模型
3. **BYOK 解锁**：只有配了对应 Key 的模型才能选
4. **非 BYOK 用户**：只能选平台提供的默认模型（成本含在订阅里）

### 数据模型

```typescript
// Organization 扩展
{
  modelPreferences: {
    chat: string,          // 'deepseek-v3'（默认）
    copy: string,          // 'deepseek-v3'
    frameEdit: string,     // 'gemini-flash'
    videoGen: string,      // 'kling-v3'
    analysis: string,      // 'deepseek-v3'
  },
  // 各模型价格倍率（相对默认模型）
  // GPT-4o = 10x DeepSeek, Claude = 8x, Gemini Pro = 3x
}

// Pipeline 扩展（可选覆盖）
{
  modelOverrides: {
    copy?: string,
    frameEdit?: string,
    videoGen?: string,
  }
}
```

### 前端 UI

**Settings → AI 模型配置**
```
┌──────────────────────────────────────────────┐
│  🤖 AI 模型偏好                              │
│                                              │
│  对话模型    [DeepSeek V3 ▾]  ← 免费         │
│  文案模型    [DeepSeek V3 ▾]  ← 免费         │
│  帧编辑      [Gemini Flash ▾] ← 免费         │
│  视频生成    [Kling V3 ▾]     ← 含在条数内    │
│  分析模型    [DeepSeek V3 ▾]  ← 免费         │
│                                              │
│  ⚡ 高级模型需要 BYOK 或专业版以上            │
│  [GPT-4o] [Claude] 🔒 需配置 API Key         │
│                                              │
│  [保存偏好]                                   │
└──────────────────────────────────────────────┘
```

**Dashboard → 用量统计**
```
┌──────────────────────────────────────────────┐
│  📊 本月 Token 用量                           │
│                                              │
│  已用 45,230 / 200,000 tokens (22.6%)        │
│  ████████░░░░░░░░░░░░░░░░░░░░░░ 22.6%       │
│                                              │
│  模型分布                                     │
│  DeepSeek V3   38,500 tokens  85.1%          │
│  Gemini Flash   6,730 tokens  14.9%          │
│                                              │
│  预估成本: ¥0.05（已含在订阅内）              │
│                                              │
│  [查看明细 →]                                 │
└──────────────────────────────────────────────┘
```

---

## 实现计划

### Phase A: 数据层（后端）
1. 新增 `conversation-usage.schema.ts`
2. Organization schema 扩展 `monthlyTokenQuota` + `modelPreferences`
3. Pipeline schema 扩展 `modelOverrides`
4. 新增 `UsageTrackingService`（记录对话消耗）
5. 新增 `ModelResolverService`（根据 org/pipeline 设置解析实际模型）

### Phase B: API 层
1. `GET /api/v1/usage/conversation-summary`
2. `GET /api/v1/usage/conversation-detail`
3. `GET /api/v1/usage/model-breakdown`
4. `POST /api/v1/usage/track-conversation`
5. `PATCH /api/v1/org/model-preferences`
6. `PATCH /api/v1/pipelines/:id/model-overrides`

### Phase C: 前端
1. Settings → 新增「AI 模型配置」tab
2. Dashboard → 新增 Token 用量卡片 + 模型分布图
3. Billing → 对话 Token 用量板块
4. 管线设置 → 模型覆盖选项

### Phase D: 集成
1. Skill 层调用 track-conversation API
2. 管线执行时通过 ModelResolver 获取模型
3. 接近配额时触发通知
4. 自检 + 部署

---

## 讨论要点（需 Codex 确认）

1. ConversationUsage 是新 collection 还是复用 UsageHistory？
2. ModelResolver 放在哪个模块？独立 module 还是挂在 org 下？
3. 套餐的 monthlyTokenQuota 是写死代码还是存 DB（考虑灵活定价）？
4. Pipeline modelOverrides 前端 UI 放在管线编辑页还是独立页面？
