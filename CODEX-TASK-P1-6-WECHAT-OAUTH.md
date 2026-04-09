# Codex Task: P1-6 微信 OAuth + 支付前端对接 + BYOK

## Context
Working dir: `project/aitoearn-backend/`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Background
Three P1 items that are relatively contained:
1. WeChat OAuth is a throw stub
2. Payment frontend needs real XorPay integration (backend already done)
3. BYOK has only a single key field, needs multi-key + auto-routing

## Task 1: WeChat OAuth Implementation

In `auth.service.ts`, replace the `wechatCallback` stub:

```typescript
async wechatCallback(code: string) {
  // 1. Exchange code for access_token + openid
  //    GET https://api.weixin.qq.com/sns/oauth2/access_token
  //    ?appid={WECHAT_APP_ID}&secret={WECHAT_APP_SECRET}&code={code}&grant_type=authorization_code
  // 2. Get user info with access_token
  //    GET https://api.weixin.qq.com/sns/userinfo?access_token={token}&openid={openid}
  // 3. Find or create user by wechat openid
  // 4. Return JWT tokens
}
```

- Read `WECHAT_APP_ID` and `WECHAT_APP_SECRET` from env
- If env vars not set, throw clear error: "WeChat OAuth not configured: set WECHAT_APP_ID and WECHAT_APP_SECRET"
- Add `wechatOpenId` and `wechatUnionId` fields to MediaClawUser schema (if not present)
- Find user by wechatOpenId → if not found, create new user → return JWT

Add controller route:
- `GET /api/v1/auth/wechat/login` — return redirect URL to WeChat OAuth page
- `POST /api/v1/auth/wechat/callback` — exchange code (already exists, just implement)

## Task 2: BYOK Multi-Key Management

### Update Organization Schema
Add to `organization.schema.ts`:
```typescript
@Prop({ type: Object, default: {} }) apiKeys: {
  kling?: { encryptedKey: string; addedAt: Date; lastUsedAt?: Date }
  gemini?: { encryptedKey: string; addedAt: Date; lastUsedAt?: Date }
  deepseek?: { encryptedKey: string; addedAt: Date; lastUsedAt?: Date }
  openai?: { encryptedKey: string; addedAt: Date; lastUsedAt?: Date }
  tikhub?: { encryptedKey: string; addedAt: Date; lastUsedAt?: Date }
}
```

### BYOK Service
Create `apps/aitoearn-server/src/core/mediaclaw/settings/byok.service.ts`:
- `setApiKey(orgId, provider, plainKey)` — encrypt (AES-256-GCM) + store
- `getApiKey(orgId, provider)` — decrypt + return (or return platform default if not set)
- `removeApiKey(orgId, provider)` — remove key
- `listApiKeys(orgId)` — list providers with masked keys (last 4 chars)
- `resolveApiKey(orgId, provider)` — return org key if exists, else platform default
  - This is what pipeline services call to get the right key

Encryption: use `crypto.createCipheriv('aes-256-gcm', ...)` with key from env `BYOK_ENCRYPTION_KEY`.

### Settings Controller
Add to existing settings controller (or create):
- `POST /api/v1/settings/api-keys` — set key (body: { provider, key })
- `GET /api/v1/settings/api-keys` — list keys (masked)
- `DELETE /api/v1/settings/api-keys/:provider` — remove key

## Rules
- WeChat OAuth: real HTTP calls with proper error handling, but gracefully degrade if env vars not set
- BYOK encryption must use proper AES-256-GCM (not just base64)
- Build pass + push after each commit
