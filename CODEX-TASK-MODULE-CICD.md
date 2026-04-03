# MediaClaw Per-Module CI/CD Pipeline

## Goal
Create a CI/CD pipeline that tests EACH of the 34 MediaClaw modules independently, not just the monolith build.

## Task 1: Create Per-Module Test Specs
For each module that doesn't have tests yet, create a `*.spec.ts` file:

Each spec should at minimum test:
1. **Module can bootstrap** — `Test.createTestingModule({ imports: [XxxModule] })` compiles
2. **Service is defined** — service can be injected
3. **Controller is defined** — controller can be injected  
4. **Key methods exist** — verify service methods are callable (mock deps)

Create specs for ALL modules missing them:
- `account/account.service.spec.ts`
- `acquisition/acquisition.service.spec.ts`
- `analytics/analytics.service.spec.ts`
- `apikey/apikey.service.spec.ts`
- `asset/asset.service.spec.ts`
- `audit/audit.service.spec.ts`
- `auth/auth.service.spec.ts`
- `billing/billing.service.spec.ts` (enhance existing)
- `brand/brand.service.spec.ts`
- `campaign/campaign.service.spec.ts`
- `clawhost/clawhost.service.spec.ts`
- `client-mgmt/client-mgmt.service.spec.ts`
- `competitor/competitor.service.spec.ts`
- `content-mgmt/content-mgmt.service.spec.ts`
- `copy/copy.service.spec.ts`
- `crawler/crawler.service.spec.ts`
- `data-dashboard/data-dashboard.service.spec.ts`
- `discovery/discovery.service.spec.ts`
- `distribution/distribution.service.spec.ts` (enhance existing)
- `health/health.service.spec.ts`
- `marketplace/marketplace.service.spec.ts`
- `notification/notification.service.spec.ts`
- `org/org.service.spec.ts`
- `payment/xorpay.service.spec.ts` (enhance existing)
- `pipeline/pipeline.service.spec.ts`
- `pipeline-system/pipeline-system.service.spec.ts`
- `platform-account/platform-account.service.spec.ts`
- `report/report.service.spec.ts`
- `skill/skill.service.spec.ts`
- `task-mgmt/task-mgmt.service.spec.ts`
- `usage/usage.service.spec.ts`
- `video/video.service.spec.ts`
- `webhook/webhook.service.spec.ts`
- `worker/video-worker.spec.ts`

Use NestJS testing utilities. Mock all MongoDB models with `getModelToken()`. Mock external services.

## Task 2: Create Module CI Matrix Workflow
Create `.github/workflows/module-ci.yml`:

```yaml
name: MediaClaw Module CI

on:
  push:
    branches: [main]
    paths:
      - 'apps/aitoearn-server/src/core/mediaclaw/**'
  pull_request:
    paths:
      - 'apps/aitoearn-server/src/core/mediaclaw/**'

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      modules: ${{ steps.changes.outputs.modules }}
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - id: changes
        run: |
          # Detect which modules changed
          CHANGED=$(git diff --name-only ${{ github.event.before || 'HEAD~1' }} HEAD -- apps/aitoearn-server/src/core/mediaclaw/ | cut -d/ -f7 | sort -u | grep -v '\.ts$' | jq -R -s -c 'split("\n") | map(select(length > 0))')
          echo "modules=$CHANGED" >> $GITHUB_OUTPUT

  test-module:
    needs: detect-changes
    if: needs.detect-changes.outputs.modules != '[]'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        module: ${{ fromJSON(needs.detect-changes.outputs.modules) }}
      fail-fast: false
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Test ${{ matrix.module }}
        run: |
          npx jest --testPathPattern="mediaclaw/${{ matrix.module }}" --passWithNoTests --forceExit
      - name: Module build check
        run: npx nx build aitoearn-server --skip-nx-cache

  all-modules:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Lint all
        run: npx nx lint aitoearn-server --skip-nx-cache
      - name: Build all
        run: npx nx build aitoearn-server --skip-nx-cache
      - name: Test all modules
        run: |
          for module in account acquisition analytics apikey asset audit auth billing brand campaign clawhost client-mgmt competitor content-mgmt copy crawler data-dashboard discovery distribution health marketplace notification org payment pipeline pipeline-system platform-account report skill task-mgmt usage video webhook worker; do
            echo "=== Testing $module ==="
            npx jest --testPathPattern="mediaclaw/$module" --passWithNoTests --forceExit 2>&1 | tail -3
            echo ""
          done
      - name: Summary
        run: echo "All 34 modules tested individually ✅"
```

## Task 3: Run All Module Tests Locally
Execute the full per-module test suite locally:
```bash
for module in account acquisition analytics apikey asset audit auth billing brand campaign clawhost client-mgmt competitor content-mgmt copy crawler data-dashboard discovery distribution health marketplace notification org payment pipeline pipeline-system platform-account report skill task-mgmt usage video webhook worker; do
  echo "=== Testing $module ==="
  npx jest --testPathPattern="mediaclaw/$module" --passWithNoTests --forceExit 2>&1 | tail -5
done
```

Fix any test failures.

## Task 4: Verify & Push
1. `npx nx lint aitoearn-server --skip-nx-cache` — pass
2. `npx nx build aitoearn-server --skip-nx-cache` — pass
3. All 34 module tests pass
4. Commit: `test(mediaclaw): add per-module specs + module CI matrix workflow`
5. `git push`

Print per-module test results at end:
```
MODULE TEST RESULTS
===================
[PASS/FAIL] account       — X tests
[PASS/FAIL] acquisition   — X tests
...
===================
Total: 34 modules, X tests, Y passed, Z failed
```

Print "PER-MODULE CI/CD COMPLETE" at end.
