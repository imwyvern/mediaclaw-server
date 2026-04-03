# MediaClaw Sprint 11 (FINAL): ClawHost + Deploy + Monitoring + Testing

## Context
Same conventions. Working dir: `project/aitoearn-backend/`
Schemas barrel: `libs/mongodb/src/schemas/index.ts`
Import from `@yikart/mongodb` only. `process.env['KEY']` not `.KEY`.
Build must pass before each commit. Push after each commit.

## Task 1: ClawHost Instance Management
Create `apps/aitoearn-server/src/core/mediaclaw/clawhost/` module:
- New schema `libs/mongodb/src/schemas/clawhost-instance.schema.ts`:
  - `instanceId` (unique)
  - `orgId`, `clientName`
  - `status` ('creating' | 'running' | 'stopped' | 'error' | 'upgrading')
  - `config` ({ cpu: string, memory: string, storage: string })
  - `skills[]` ({ skillId: string, version: string, installedAt: Date })
  - `healthStatus` ({ lastCheck: Date, isHealthy: boolean, latency: number })
  - `k8sNamespace`, `k8sPodName`
  - `createdAt`, `updatedAt`
- Add to barrel + register
- `clawhost.service.ts`:
  - `createInstance(orgId, config)` — create instance record + stub K8s pod creation
  - `stopInstance(instanceId)` — mark stopped
  - `restartInstance(instanceId)` — mark restarting → running
  - `getInstanceHealth(instanceId)` — return health status
  - `installSkill(instanceId, skillId, version)` — add skill to instance
  - `batchUpgradeSkill(skillId, version)` — upgrade skill across all running instances
  - `listInstances(filters, pagination)` — list with status/org filter
  - `runHealthCheck()` — check all running instances, update health, flag unhealthy
  - `getInstanceLogs(instanceId, lines)` — stub log retrieval
- `clawhost.controller.ts`:
  - `POST /api/v1/clawhost/instances` — create
  - `POST /api/v1/clawhost/instances/:id/stop` — stop
  - `POST /api/v1/clawhost/instances/:id/restart` — restart
  - `GET /api/v1/clawhost/instances/:id/health` — health check
  - `POST /api/v1/clawhost/instances/:id/skills` — install skill
  - `PUT /api/v1/clawhost/skills/:skillId/upgrade` — batch upgrade
  - `GET /api/v1/clawhost/instances` — list
  - `GET /api/v1/clawhost/instances/:id/logs` — logs
- Register in `mediaclaw.module.ts`

## Task 2: Deployment Configuration
Create deployment files in project root:
- `docker-compose.production.yml`:
  - Services: api (NestJS), worker (video), mongodb, redis, rustfs, nginx
  - Volumes for data persistence (mongodb, redis, rustfs, logs)
  - Resource limits per container
  - Health checks for all services
  - Network: mediaclaw-net (bridge)
  - Environment file: `.env.production`
- `docker-compose.monitoring.yml`:
  - node-exporter
  - Prometheus (with `prometheus.yml` config scraping NestJS /health + node-exporter)
  - Grafana (with provisioned datasource for Prometheus)
  - Alertmanager with WeCom webhook config
- `.env.production.example` — template with all required vars
- `scripts/deploy.sh` — automated deploy script:
  - Pull latest code
  - Build Docker images
  - Run migrations (if any)
  - docker compose up -d
  - Health check verification
  - Rollback on failure

## Task 3: E2E + Stress + Security Tests
- `test/e2e/auth.e2e-spec.ts`:
  - Test SMS login flow
  - Test enterprise registration
  - Test JWT refresh
  - Test role-based access (admin vs viewer)
- `test/e2e/video-pipeline.e2e-spec.ts`:
  - Test video job creation
  - Test job status polling
  - Test credit deduction after completion
- `test/e2e/payment.e2e-spec.ts`:
  - Test order creation
  - Test callback processing
  - Test order expiry
- `test/stress/concurrent-video.spec.ts`:
  - Simulate 10 concurrent video production jobs
  - Verify no race conditions on credit deduction
  - Verify BullMQ queue ordering
- `test/security/security-audit.spec.ts`:
  - XSS input sanitization test
  - CSRF token validation test
  - SQL/NoSQL injection test
  - PIPL data handling (PII encryption check)
  - API key permission boundary test
- `scripts/backup.sh`:
  - MongoDB dump to compressed archive
  - Upload to configured S3/OSS bucket
  - Retention: keep last 7 daily + 4 weekly
  - Cron schedule comment

## After ALL tasks:
1. `npx nx build aitoearn-server` — must pass
2. 3 atomic commits (one per task), push after each
3. Print "ALL SPRINT 11 TASKS COMPLETE — BACKEND 100%" at end
