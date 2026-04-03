# MediaClaw Sprint 10: Payment + Infrastructure + Testing

## Context
Same conventions. Working dir: `project/aitoearn-backend/`
All modules in `apps/aitoearn-server/src/core/mediaclaw/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Task 1: Payment Integration (XorPay Migration)
Create `apps/aitoearn-server/src/core/mediaclaw/payment/` module:
- New schema `libs/mongodb/src/schemas/payment-order.schema.ts`:
  - `orderId` (unique, auto-generated)
  - `orgId`, `userId`
  - `amount` (number, cents), `currency` (string, default 'CNY')
  - `paymentMethod` ('wechat_native' | 'wechat_jsapi' | 'alipay')
  - `status` ('pending' | 'paid' | 'failed' | 'expired' | 'refunded')
  - `callbackData` (Mixed), `paidAt`, `expiredAt`
  - `productType` ('video_pack' | 'subscription' | 'addon')
  - `productId`, `quantity`
  - TTL index: expire `pending` orders after 30 minutes
- Add to barrel + register
- `xorpay.service.ts`:
  - `createOrder(params)` — create payment order + call XorPay API
  - `handleCallback(body, signature)` — verify MD5 signature, update order status
  - `getOrderStatus(orderId)` — check current status
  - `listOrders(orgId, filters, pagination)` — list with status filter
  - `checkAmountConsistency(orderId, callbackAmount)` — verify amount matches
  - `cancelExpiredOrders()` — cron job to mark expired orders
- `xorpay.controller.ts`:
  - `POST /api/v1/payment/create` — create order
  - `POST /api/v1/payment/callback` — XorPay webhook (no auth, verify signature)
  - `GET /api/v1/payment/status/:orderId` — get order status
  - `GET /api/v1/payment/orders` — list orders
  - `GET /api/v1/payment/products` — list available products/packs
- Rate limiting: use `@nestjs/throttler` on create endpoint (5 req/min per user)
- Register in `mediaclaw.module.ts`

## Task 2: Infrastructure — Docker + Nginx + Health
Enhance existing infrastructure:
- Create `docker/Dockerfile.ffmpeg-base`:
  - Based on `node:20-slim`
  - Install ffmpeg with libfreetype + Noto Sans CJK fonts
  - Used as base image for worker containers
- Create `docker/nginx/mediaclaw.conf`:
  - Upstream: `api_server` pointing to NestJS port 3000
  - `location /api/v1/` → proxy to api_server
  - `location /` → proxy to Next.js frontend (port 3001)
  - Rate limiting zone: `limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m`
  - WebSocket support for `/api/v1/ws`
  - CORS headers
  - SSL placeholder comments
- Add `NestJS TerminusModule` health checks in `apps/aitoearn-server/src/core/mediaclaw/health/`:
  - MongoDB check
  - Redis check
  - BullMQ check
  - Disk storage check
  - Memory heap check
- Add `bull-board` dashboard at `/api/v1/admin/queues` (admin auth required)

## Task 3: CI/CD Pipeline
Create `.github/workflows/ci.yml`:
- Trigger on push to main + PR
- Jobs:
  - `lint`: run `npx nx lint aitoearn-server`
  - `build`: run `npx nx build aitoearn-server`
  - `test`: run `npx nx test aitoearn-server` (if tests exist)
  - `docker`: build Docker image (only on main push)
- Cache node_modules and nx cache
- Use Node.js 20

Create `.github/workflows/deploy.yml`:
- Trigger on tag `v*`
- Build Docker image + push to registry
- SSH deploy to production server
- Placeholder for actual deploy commands

## Task 4: Unit + Integration Tests
Create test files:
- `apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service.spec.ts`:
  - Test order creation
  - Test callback signature verification (valid + invalid)
  - Test amount consistency check
  - Test order expiry
- `apps/aitoearn-server/src/core/mediaclaw/billing/billing.service.spec.ts`:
  - Test credit deduction (FIFO)
  - Test idempotent charging
  - Test insufficient credits
- `apps/aitoearn-server/src/core/mediaclaw/distribution/distribution.service.spec.ts`:
  - Test rule evaluation
  - Test content distribution
  - Test publish status tracking

## After ALL tasks:
1. `npx nx build aitoearn-server` — must pass
2. 4 atomic commits (one per task), push after each
3. Print "ALL SPRINT 10 TASKS COMPLETE" at end
