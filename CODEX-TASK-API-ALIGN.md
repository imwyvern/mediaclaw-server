# Task: Fix Frontend-Backend API Path Mismatch

## Problem
Frontend API client (`~/projects/mediaclaw/web/src/lib/api.ts`) uses paths that don't match the actual backend routes.

## Backend Actual Routes (all confirmed working, 200):
```
/api/v1/auth/sms/send        — POST (send SMS code)
/api/v1/auth/sms/verify      — POST (verify SMS code, returns token)
/api/v1/auth/enterprise/register — POST
/api/v1/auth/refresh         — POST
/api/v1/auth/my-orgs         — GET
/api/v1/brand                — GET/POST (CRUD)
/api/v1/content-mgmt         — GET (list content)
/api/v1/content-mgmt/pending — GET
/api/v1/content-mgmt/export  — POST
/api/v1/video/task           — GET (list tasks)
/api/v1/platform-account     — GET/POST
/api/v1/payment/products     — GET
/api/v1/payment/create       — POST
/api/v1/payment/orders       — GET
/api/v1/billing/balance      — GET
/api/v1/billing/orders       — GET
/api/v1/apikey               — GET/POST
/api/v1/skill/config         — GET
/api/v1/skill/register       — POST
/api/v1/skill/deliveries     — GET
/api/v1/analytics/overview   — GET
/api/v1/campaign             — (check: singular, not plural)
/api/v1/account              — (check: might be different from platform-account)
```

## Frontend Current Paths (WRONG):
```
/v1/content           → Should be /v1/content-mgmt
/v1/brands            → Should be /v1/brand (singular)
/v1/tasks             → Should be /v1/video/task
/v1/campaigns         → Should be /v1/campaign (singular)
/v1/account           → Check actual path
/v1/account/usage     → Check actual path
/v1/auth/login        → Should be /v1/auth/sms/verify
/v1/billing/orders    → Already correct
```

## Also Fix:
1. `API_BASE_URL` defaults to `http://8.129.133.52/api` — should be `/api` (relative) for production
2. Auth flow: frontend should call `sms/send` first, then `sms/verify` (not a single `login` endpoint)
3. Token refresh: endpoint is `/v1/auth/refresh` — check the request body format
4. Brand: the backend uses singular `/v1/brand`, fix all references

## Fix Location
- File: `~/projects/mediaclaw/web/src/lib/api.ts`
- Also check page files that may have inline API calls: `src/app/dashboard/*/page.tsx`

## Rules
- One commit per logical fix
- `cd ~/projects/mediaclaw/web && npm run build` must pass after EVERY commit
- Conventional Commits format
- Test each fix by curling the corrected path
