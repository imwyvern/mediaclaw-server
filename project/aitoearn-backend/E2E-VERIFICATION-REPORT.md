# E2E 验证报告

- 任务来源: `/Users/wes/projects/mediaclaw/server/CODEX-TASK-E2E-CHECK.md`
- 验证目标: `http://8.129.133.52`
- 执行日期: `2026-03-31`
- 执行方式: 直接对 live server 执行 `curl`，未使用 SSH，未使用 mock
- 原始产物目录: `/tmp/mediaclaw-e2e-20260331-061236`

## 测试上下文

- 测试手机号: `11774962756`
- 测试邮箱: `e2e-20260331-061236@mediaclaw.test`
- 测试组织: `E2E Org 20260331-061236`
- 测试品牌名: `E2E Brand 20260331-061236`
- 测试内容标题: `E2E Content 20260331-061236`
- 测试平台账号名: `e2e_douyin_20260331-061236`
- 测试 Agent ID: `e2e-agent-20260331-061236`
- Access Token: `<REDACTED_JWT>`
- Refresh Token: `<REDACTED_JWT>`
- API Key: `<REDACTED_API_KEY>`
- API Key 前缀: `mc_live_e10c70ff`
- Organization ID: `69cbc852c0e4b4f25599996f`
- User ID: `69cbc852c0e4b4f255999974`
- Brand ID: `69cbc860c0e4b4f255999981`
- Content ID: 未创建成功
- Platform Account ID: `69cbc87aeda1aa83e41a7381`
- API Key ID: `69cbc887c0e4b4f2559999c4`

## 汇总

```text
=== E2E VERIFICATION SUMMARY ===
Flow 1 Health:        FAIL (health 200/code=0, frontend root 200, static assets 404)
Flow 2 Auth:          PASS (expected auth routes absent; enterprise fallback auth flow works end-to-end)
Flow 3 Brand:         PASS (create/get ok; list had one transient connection reset, retry passed)
Flow 4 Content:       FAIL (expected /content route absent; video fallback blocked by insufficient credits)
Flow 5 Account:       FAIL (expected /account create route absent; /account returns user profile, not platform accounts)
Flow 6 Payment:       FAIL (expected /payment/plans and /billing/usage absent; fallback billing/product routes work)
Flow 7 Analytics:     PASS (overview returns 200/code=0)
Flow 8 API Key:       PASS (create/list ok)
Flow 9 Skill:         FAIL (expected GET /skill absent; fallback register/config/deliveries routes work)
Flow 10 Frontend:     PASS (all requested frontend pages return 200)
================================
TOTAL: 5/10 PASSED
```

## Flow 1: Health & Infrastructure

- `GET /api/v1/health`: `HTTP 200`，`body.code=0`，`message=请求成功`
- `GET /`: `HTTP 200`
- `GET /_next/static/chunks/0yb2wil16uz6h.js`: `HTTP 404`，body 为 `Not Found`
- 首页 HTML 中实际引用了这些静态资源:
  - `/_next/static/chunks/0neevhl_o1ozu.css`
  - `/_next/static/chunks/0v4u3m0g.42xq.js`
  - `/_next/static/chunks/0qzhral4i3neo.js`
- 补充验证: `GET /_next/static/chunks/0v4u3m0g.42xq.js` 同样返回 `HTTP 404`

结论: 后端健康检查可用，但前端部署产物不完整。页面壳子虽然返回 `200`，但关键 JS/CSS chunk 缺失，浏览器侧功能大概率不完整。

失败完整响应:

```http
HTTP/1.1 404 Not Found
Server: nginx/1.29.7
Content-Type: text/plain; charset=utf-8

Not Found
```

## Flow 2: Auth Flow

任务文档里给出的 auth 路径在 live 环境不存在，但任务规则明确允许在 auth 路径不一致时尝试常见替代路径，所以这里按“真实可用认证链路”完成了验证。

文档预期路径结果:

- `POST /api/v1/auth/register`: `HTTP 200`，`body.code=404`，`message=Cannot POST /api/v1/auth/register`
- `POST /api/v1/auth/login`: `HTTP 200`，`body.code=404`，`message=Cannot POST /api/v1/auth/login`
- `GET /api/v1/auth/me`: `HTTP 200`，`body.code=404`，`message=Cannot GET /api/v1/auth/me`

真实可用 fallback 认证链路:

- `POST /api/v1/auth/enterprise/register`: `HTTP 200`，`body.code=0`
  - 成功创建组织 `69cbc852c0e4b4f25599996f`
  - 成功创建管理员用户 `69cbc852c0e4b4f255999974`
  - 返回 access token / refresh token，已在报告中脱敏
- `GET /api/v1/account/info`: `HTTP 200`，`body.code=0`
  - 正常返回当前用户资料 `E2E Admin`
- `GET /api/v1/auth/my-orgs`: `HTTP 200`，`body.code=0`
  - 正常返回刚创建的企业组织
- `POST /api/v1/auth/refresh`: `HTTP 200`，`body.code=0`
  - 正常刷新 token，返回新 token，已脱敏

结论: 按任务允许的 auth fallback 规则，这一项记为 PASS。也就是说 live 系统认证是可用的，但文档中的邮箱注册/登录路径已经和实际实现脱节。

失败完整响应:

```json
{"data":{},"code":404,"message":"Cannot POST /api/v1/auth/register","timestamp":1774962766743}
{"data":{},"code":404,"message":"Cannot POST /api/v1/auth/login","timestamp":1774962769113}
{"data":{},"code":404,"message":"Cannot GET /api/v1/auth/me","timestamp":1774962779085}
```

## Flow 3: Brand CRUD

- `POST /api/v1/brand`: `HTTP 200`，`body.code=0`
  - 成功创建品牌 `69cbc860c0e4b4f255999981`
- 首次 `GET /api/v1/brand`: `curl exit=56`，`HTTP 000`
  - stderr: `curl: (56) Recv failure: Connection reset by peer`
- 重试 `GET /api/v1/brand`: `HTTP 200`，`body.code=0`
  - 成功返回刚创建的品牌
- `GET /api/v1/brand/69cbc860c0e4b4f255999981`: `HTTP 200`，`body.code=0`

结论: PASS。品牌 CRUD 能跑通。列表接口第一次出现了瞬时连接重置，但立即重试成功，数据一致。

瞬时失败证据:

```text
curl: (56) Recv failure: Connection reset by peer
```

## Flow 4: Content Management

- `POST /api/v1/content`: `HTTP 200`，`body.code=404`，`message=Cannot POST /api/v1/content`
- fallback `POST /api/v1/video`: `HTTP 200`，`body.code=404`，`message=Insufficient credits. Purchase a video pack to continue.`
- `GET /api/v1/content`: `HTTP 200`，`body.code=0`
  - 返回 `items=[]`，`total=0`
- `GET /api/v1/content/<CONTENT_ID>`: 因内容未创建成功而跳过

结论: FAIL。文档中的内容创建路径不存在；真实可用的视频创建路径又被余额不足拦住，导致无法完成完整内容流转。

这里还有一个明显不一致:

- 企业注册返回的订阅数据里 `monthlyQuota=50`、`monthlyUsed=0`
- 账单/使用量接口返回 `remaining=0`
- 实际创建视频直接报 `Insufficient credits`

失败完整响应:

```json
{"data":{},"code":404,"message":"Cannot POST /api/v1/content","timestamp":1774962802934}
{"data":{},"code":404,"message":"Insufficient credits. Purchase a video pack to continue.","timestamp":1774962805564}
```

## Flow 5: Account (Platform Accounts)

- `POST /api/v1/account`: `HTTP 200`，`body.code=404`，`message=Cannot POST /api/v1/account`
- `GET /api/v1/account`: `HTTP 200`，`body.code=0`
  - 返回的是当前用户资料，不是平台账号列表
- fallback `POST /api/v1/platform-accounts`: `HTTP 200`，`body.code=0`
  - 成功创建平台账号 `69cbc87aeda1aa83e41a7381`
- fallback `GET /api/v1/platform-accounts`: `HTTP 200`，`body.code=0`
  - 成功列出刚创建的抖音账号
- fallback `GET /api/v1/platform-accounts/69cbc87aeda1aa83e41a7381`: `HTTP 200`，`body.code=0`

结论: 按任务文档口径记为 FAIL。live 系统里 `/api/v1/account` 是用户资料域，不是平台账号域；平台账号 CRUD 实际在 `/api/v1/platform-accounts`。

失败完整响应:

```json
{"data":{},"code":404,"message":"Cannot POST /api/v1/account","timestamp":1774962809721}
```

`GET /api/v1/account` 返回用户资料而非账号列表的证据:

```json
{
  "code": 0,
  "message": "请求成功",
  "data": {
    "id": "69cbc852c0e4b4f255999974",
    "phone": "11774962756",
    "email": "",
    "name": "E2E Admin",
    "avatarUrl": "",
    "orgId": "69cbc852c0e4b4f25599996f",
    "role": "admin",
    "userType": "enterprise",
    "imBindings": [],
    "lastLoginAt": "2026-03-31T13:12:50.796Z",
    "createdAt": "2026-03-31T13:12:50.794Z"
  }
}
```

## Flow 6: Payment & Billing

- `GET /api/v1/payment/plans`: `HTTP 200`，`body.code=404`，`message=Cannot GET /api/v1/payment/plans`
- fallback `GET /api/v1/payment/products`: `HTTP 200`，`body.code=0`
  - 返回 4 个产品: `single`、`pack_10`、`pack_30`、`pack_100`
- `GET /api/v1/billing/usage`: `HTTP 200`，`body.code=404`，`message=Cannot GET /api/v1/billing/usage`
- fallback `GET /api/v1/account/usage`: `HTTP 200`，`body.code=0`
  - 返回 `credits.remaining=0`
- fallback `GET /api/v1/billing/balance`: `HTTP 200`，`body.code=0`
  - 返回 `totalRemaining=0`

结论: 按任务文档口径记为 FAIL。live 上不是没有支付/账单数据，而是路径和文档不一致。

失败完整响应:

```json
{"data":{},"code":404,"message":"Cannot GET /api/v1/payment/plans","timestamp":1774962815057}
{"data":{},"code":404,"message":"Cannot GET /api/v1/billing/usage","timestamp":1774962817980}
```

## Flow 7: Analytics

- `GET /api/v1/analytics/overview`: `HTTP 200`，`body.code=0`
- 返回指标:
  - `totalVideos=0`
  - `creditsUsed=0`
  - `successRate=0`
  - `performance.views=0`
  - `performance.likes=0`
  - `performance.comments=0`

结论: PASS。Analytics 总览接口结构正常、返回成功。

## Flow 8: API Key Management

- `POST /api/v1/apikey`: `HTTP 200`，`body.code=0`
  - 成功创建 API key 记录 `69cbc887c0e4b4f2559999c4`
  - live key 原值只返回一次，报告中已脱敏
  - key 前缀为 `mc_live_e10c70ff`
- `GET /api/v1/apikey`: `HTTP 200`，`body.code=0`
  - 成功列出刚创建的 API key

结论: PASS。API Key 创建和查询在 live 环境可用。

## Flow 9: Skill Endpoints

- `GET /api/v1/skill`: `HTTP 200`，`body.code=404`，`message=Cannot GET /api/v1/skill`
- fallback `POST /api/v1/skill/register`，使用 Bearer API key: `HTTP 200`，`body.code=0`
  - 成功注册 agent `e2e-agent-20260331-061236`
- fallback `GET /api/v1/skill/config?agentId=e2e-agent-20260331-061236`: `HTTP 200`，`body.code=0`
  - 配置中包含本次创建的品牌
- fallback `GET /api/v1/skill/deliveries?agentId=e2e-agent-20260331-061236`: `HTTP 200`，`body.code=0`
  - 返回空数组

结论: 按任务文档口径记为 FAIL。live 系统不是通过 `/api/v1/skill` 根路径暴露能力，而是通过 register/config/deliveries 等具体子路径。

失败完整响应:

```json
{"data":{},"code":404,"message":"Cannot GET /api/v1/skill","timestamp":1774962826486}
```

## Flow 10: Frontend Pages

任务要求的所有页面都返回了 `HTTP 200`:

```text
/ -> 200
/auth -> 200
/pricing -> 200
/dashboard -> 200
/dashboard/videos -> 200
/dashboard/brands -> 200
/dashboard/campaigns -> 200
/dashboard/analytics -> 200
/dashboard/billing -> 200
/dashboard/settings -> 200
/dashboard/onboarding -> 200
```

结论: 按“页面路由可达”标准记为 PASS。但这必须和 Flow 1 一起看，因为前端 chunk 404 意味着页面 `200` 不能等价于浏览器端功能完整。

## 关键发现

1. live 路由契约和任务文档明显不一致。
   - auth、content、account、payment、skill 多个模块的文档路径和实际路径不一致。
   - 多个“路径不存在”的 API 并没有返回真实 `HTTP 404`，而是 `HTTP 200 + body.code=404`。

2. 前端部署处于部分损坏状态。
   - HTML 路由都能打开。
   - 但多个被页面引用的 Next.js 静态资源返回 `404`。
   - 这更像是部署产物不完整，或者 HTML 指向了不存在的 chunk。

3. 新建企业组织的配额/余额行为存在明显冲突。
   - 注册响应里有 `monthlyQuota=50`
   - 使用量接口里 `remaining=0`
   - 实际视频创建直接因为余额不足失败

4. 本次验证中确认存在且可工作的 live 路径如下。
   - Auth: `/api/v1/auth/enterprise/register`、`/api/v1/auth/my-orgs`、`/api/v1/auth/refresh`、`/api/v1/account/info`
   - Platform Accounts: `/api/v1/platform-accounts`
   - Payment/Billing: `/api/v1/payment/products`、`/api/v1/account/usage`、`/api/v1/billing/balance`
   - Skill: `/api/v1/skill/register`、`/api/v1/skill/config`、`/api/v1/skill/deliveries`

## 最终结论

- live server 具备部分可用能力，但不能按任务文档原样跑出全绿。
- 严格按任务文档统计: `5/10` 通过。
- 从真实能力看，以下模块在 fallback 路径上是可工作的:
  - auth 企业注册链路
  - brand CRUD
  - platform account CRUD
  - payment/billing 查询
  - skill 注册与配置拉取
- 当前阻塞全绿 E2E 的核心问题:
  - 前端静态资源缺失
  - 内容创建被 0 credits 阻塞
  - 多个模块的 live 路径与文档严重偏离
