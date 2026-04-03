# Task: E2E Flow Verification on Live Server

Target: `http://8.129.133.52`

## Instructions
Run a comprehensive E2E check against the live deployed MediaClaw. Use `curl` for API calls and verify each step returns expected results.

## Flow 1: Health & Infrastructure
```bash
# 1. API health
curl -s http://8.129.133.52/api/v1/health | jq .
# Expected: {"data":{"status":"ok",...}}

# 2. Frontend loads
curl -s -o /dev/null -w "%{http_code}" http://8.129.133.52/
# Expected: 200

# 3. Frontend static assets load
curl -s -o /dev/null -w "%{http_code}" http://8.129.133.52/_next/static/chunks/0yb2wil16uz6h.js
# Expected: 200
```

## Flow 2: Auth Flow
```bash
# 1. Register a test user
curl -s -X POST http://8.129.133.52/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-test@mediaclaw.test","password":"TestPass123!","name":"E2E Test User"}' | jq .

# 2. Login
curl -s -X POST http://8.129.133.52/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-test@mediaclaw.test","password":"TestPass123!"}' | jq .
# Save the token from response

# 3. Get current user profile
curl -s http://8.129.133.52/api/v1/auth/me \
  -H "Authorization: Bearer <TOKEN>" | jq .
```

## Flow 3: Brand CRUD
```bash
# Use the token from login
# 1. Create brand
curl -s -X POST http://8.129.133.52/api/v1/brand \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"name":"E2E Test Brand","description":"Test brand for E2E verification"}' | jq .

# 2. List brands
curl -s http://8.129.133.52/api/v1/brand \
  -H "Authorization: Bearer <TOKEN>" | jq .

# 3. Get brand by ID
curl -s http://8.129.133.52/api/v1/brand/<BRAND_ID> \
  -H "Authorization: Bearer <TOKEN>" | jq .
```

## Flow 4: Content Management
```bash
# 1. Create content
curl -s -X POST http://8.129.133.52/api/v1/content \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"title":"E2E Test Video","brandId":"<BRAND_ID>","type":"short_video","platform":"douyin"}' | jq .

# 2. List content
curl -s http://8.129.133.52/api/v1/content \
  -H "Authorization: Bearer <TOKEN>" | jq .

# 3. Get content by ID
curl -s http://8.129.133.52/api/v1/content/<CONTENT_ID> \
  -H "Authorization: Bearer <TOKEN>" | jq .
```

## Flow 5: Account (Platform Accounts)
```bash
# 1. Create platform account
curl -s -X POST http://8.129.133.52/api/v1/account \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"platform":"douyin","accountName":"test_douyin_account","brandId":"<BRAND_ID>"}' | jq .

# 2. List accounts
curl -s http://8.129.133.52/api/v1/account \
  -H "Authorization: Bearer <TOKEN>" | jq .
```

## Flow 6: Payment & Billing
```bash
# 1. Get pricing/plans
curl -s http://8.129.133.52/api/v1/payment/plans \
  -H "Authorization: Bearer <TOKEN>" | jq .

# 2. Get usage/billing info
curl -s http://8.129.133.52/api/v1/billing/usage \
  -H "Authorization: Bearer <TOKEN>" | jq .
```

## Flow 7: Analytics
```bash
curl -s http://8.129.133.52/api/v1/analytics/overview \
  -H "Authorization: Bearer <TOKEN>" | jq .
```

## Flow 8: API Key Management
```bash
# 1. Create API key
curl -s -X POST http://8.129.133.52/api/v1/apikey \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"name":"E2E Test Key","permissions":["read","write"]}' | jq .

# 2. List API keys
curl -s http://8.129.133.52/api/v1/apikey \
  -H "Authorization: Bearer <TOKEN>" | jq .
```

## Flow 9: Skill Endpoints
```bash
curl -s http://8.129.133.52/api/v1/skill \
  -H "Authorization: Bearer <TOKEN>" | jq .
```

## Flow 10: Frontend Pages (check all return 200)
```bash
for path in / /auth /pricing /dashboard /dashboard/videos /dashboard/brands /dashboard/campaigns /dashboard/analytics /dashboard/billing /dashboard/settings /dashboard/onboarding; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://8.129.133.52${path}")
  echo "$path -> $code"
done
```

## Output Format
Print a summary table at the end:

```
=== E2E VERIFICATION SUMMARY ===
Flow 1 Health:        PASS/FAIL (details)
Flow 2 Auth:          PASS/FAIL (details)
Flow 3 Brand:         PASS/FAIL (details)
Flow 4 Content:       PASS/FAIL (details)
Flow 5 Account:       PASS/FAIL (details)
Flow 6 Payment:       PASS/FAIL (details)
Flow 7 Analytics:     PASS/FAIL (details)
Flow 8 API Key:       PASS/FAIL (details)
Flow 9 Skill:         PASS/FAIL (details)
Flow 10 Frontend:     PASS/FAIL (details)
================================
TOTAL: X/10 PASSED
```

## Rules
- Use real HTTP calls to the live server, not mocks
- Chain the token from login to all subsequent requests
- If an endpoint returns 404 or 500, note the exact error and continue
- If auth endpoints don't exist at expected paths, try common alternatives (/api/v1/auth/signup, /api/v1/users/login, etc.)
- Print FULL response for any failures
- At the end, commit a `E2E-VERIFICATION-REPORT.md` with the full results
