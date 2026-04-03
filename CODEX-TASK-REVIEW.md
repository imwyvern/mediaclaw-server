# MediaClaw Full Code Review + Per-Module CI Verification

## Context
Working dir: `project/aitoearn-backend/`
34 MediaClaw modules in `apps/aitoearn-server/src/core/mediaclaw/`
This is a comprehensive quality pass — verify every module compiles, review all code for issues.

## Phase 1: Per-Module Compilation Verification
For EACH of the 34 modules, verify:
1. All TypeScript files compile without errors
2. All imports resolve correctly (no missing deps, no circular imports)
3. All schemas are properly registered in barrel `libs/mongodb/src/schemas/index.ts`
4. All modules are registered in `mediaclaw.module.ts`
5. All controllers have proper decorators (@Controller, @Get, @Post, etc.)
6. All services use proper DI (@Injectable, @InjectModel, etc.)

Run: `npx nx build aitoearn-server --skip-nx-cache` — must pass with 0 errors.
If any errors, fix them immediately.

Modules to verify (all 34):
account, acquisition, analytics, apikey, asset, audit, auth, billing, brand,
campaign, clawhost, client-mgmt, competitor, content-mgmt, copy, crawler,
data-dashboard, discovery, distribution, health, marketplace, notification,
org, payment, pipeline, pipeline-system, platform-account, report, skill,
task-mgmt, usage, video, webhook, worker

## Phase 2: Full Code Review (CRITICAL Pass)
Review ALL mediaclaw code for these critical issues:

### Security
- [ ] SQL/NoSQL injection: verify all user input is sanitized before DB queries
- [ ] Auth bypass: verify all controllers have @UseGuards() or are explicitly public
- [ ] API key exposure: no hardcoded secrets, all use process.env['KEY']
- [ ] XSS: verify response data is sanitized
- [ ] PIPL compliance: PII fields (phone, email) should be marked for encryption

### Data Integrity
- [ ] All schemas have proper indexes for query patterns
- [ ] No missing `orgId` isolation (multi-tenant must filter by orgId)
- [ ] Idempotency: payment/billing operations check for duplicates
- [ ] Proper error handling: try/catch in services, HTTP exceptions in controllers
- [ ] No floating promises (async without await)

### Architecture
- [ ] No circular dependencies between modules
- [ ] Services don't import from other module's internal files (use module exports)
- [ ] DTOs/validation: controllers validate input (class-validator or manual checks)
- [ ] Consistent naming: service methods match controller endpoint names
- [ ] All BullMQ processors have proper error handling + retry logic

### Code Quality
- [ ] No dead code / unused imports
- [ ] No TODO/FIXME without context
- [ ] No magic numbers (use constants/enums)
- [ ] Consistent error messages
- [ ] Pagination implemented consistently (skip/limit or cursor)

## Phase 3: Fix All Issues Found
For each issue found in Phase 2:
1. Classify as P0 (security), P1 (data integrity), P2 (architecture), P3 (code quality)
2. Fix ALL P0 and P1 issues immediately
3. Fix P2 issues where straightforward
4. Document remaining P3 issues as TODO comments

## Phase 4: Final Verification
1. `npx nx lint aitoearn-server --skip-nx-cache` — 0 errors
2. `npx nx build aitoearn-server --skip-nx-cache` — 0 errors
3. Run any existing tests
4. Commit all fixes: `fix(mediaclaw): code review fixes — security, data integrity, architecture`
5. Push to main

## Output Format
Print a summary table at the end:
```
MODULE REVIEW SUMMARY
=====================
Module          | Files | Issues Found | Issues Fixed | Status
----------------|-------|-------------|-------------|-------
account         | 3     | 0           | 0           | ✅ PASS
auth            | 5     | 2 P1        | 2           | ✅ FIXED
...             
=====================
Total: X modules, Y issues found, Z fixed
P0 (Security): A found / A fixed
P1 (Data): B found / B fixed  
P2 (Arch): C found / C fixed
P3 (Quality): D found / D fixed (or documented)
```

Print "FULL CODE REVIEW COMPLETE" at end.
