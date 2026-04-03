# MediaClaw Per-Module CI Verification

## Context
Working dir: `project/aitoearn-backend/`
34 modules in `apps/aitoearn-server/src/core/mediaclaw/`

## Task: Verify Each Module Independently

For each of the 34 modules, run these checks and fix any issues:

### 1. Import Verification
For each module dir, verify:
- All `.ts` files can be parsed by TypeScript without errors
- No circular imports within or between modules
- All `@InjectModel()` references match registered schemas
- All inter-module imports go through module exports (not deep internal paths)

### 2. Schema Registration Audit
Check `libs/mongodb/src/schemas/index.ts`:
- Every schema class in `schemas/*.schema.ts` is exported from barrel
- Every `@InjectModel(X.name)` in services has corresponding `MongooseModule.forFeature` in its module
- No duplicate schema registrations
- All indexes are properly defined

### 3. Controller Endpoint Audit
For each controller, verify:
- Every endpoint has proper HTTP method decorator
- Every endpoint has proper route path (no duplicates across modules)
- Auth guards are applied (or explicitly skipped for public endpoints like webhooks)
- Request validation (DTO or manual) on all POST/PUT/PATCH endpoints
- Proper HTTP status codes (201 for create, 200 for get/update, 204 for delete)

### 4. Service Method Audit
For each service, verify:
- All async methods have proper try/catch or are wrapped by NestJS exception filters
- Database queries filter by orgId where applicable (multi-tenant)
- No raw MongoDB operations bypassing Mongoose (use model methods)
- Proper pagination pattern (skip/limit with total count)

### 5. Run Full Pipeline
```bash
npx nx lint aitoearn-server --skip-nx-cache
npx nx build aitoearn-server --skip-nx-cache
```

### 6. Fix & Commit
- Fix any issues found
- If changes needed: `git add -A && git commit -m "fix(mediaclaw): per-module CI verification fixes"`
- `git push`

### Output
Print a checklist:
```
MODULE CI VERIFICATION
======================
[✅/❌] account      - imports ok, schema ok, endpoints ok, services ok
[✅/❌] acquisition  - imports ok, schema ok, endpoints ok, services ok
...
======================
Build: PASS/FAIL
Lint: PASS/FAIL
Total issues fixed: N
```

Print "PER-MODULE CI VERIFICATION COMPLETE" at end.
