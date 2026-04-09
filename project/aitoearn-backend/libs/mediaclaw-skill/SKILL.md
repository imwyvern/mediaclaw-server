---
name: mediaclaw-client
description: Operates MediaClaw delivery, publishing, analytics, competitor research, and production control workflows from an OpenClaw-style client. Use when the user wants to list videos, preview or download assets, edit captions, mark content as published, inspect stats, query competitor trends, or create and tune MediaClaw tasks.
requires:
  env:
    - MEDIACLAW_API_KEY
---

# MediaClaw Client

Use this skill when the user needs to operate MediaClaw from a local agent or OpenClaw-compatible client.

## Requirements

- Required env: `MEDIACLAW_API_KEY`
- Optional env: `MEDIACLAW_BASE_URL` (default `https://api.mediaclaw.com`)
- Optional env: `MEDIACLAW_AGENT_ID` for `register`, `config`, `discover`, `heartbeat`, `deliveries`, `confirm-delivery`, and `feedback`
- Optional env: `MEDIACLAW_CLIENT_VERSION` for `heartbeat`
- Optional env: `MEDIACLAW_AGENT_CAPABILITIES` as comma-separated defaults for `heartbeat`
- Optional env: `MEDIACLAW_DOWNLOAD_DIR` (default `./downloads/mediaclaw`)
- Runtime dependencies: `curl`, `jq`

## Entry Point

- Primary entry: `node --experimental-strip-types ./scripts/mediaclaw-client.ts`
- Transport helper: `./scripts/mc-api.sh`
- Inspect capability matrix: `node --experimental-strip-types ./scripts/mediaclaw-client.ts help`

## Capability Map

### L1 内容交付

- Core: `list`, `pending`, `preview`, `download`, `deliveries`, `confirm-delivery`, `task-list`, `task-status`
- Session/bootstrap: `register`, `config`, `discover`, `heartbeat`
- User-facing aliases: `my-videos`
- Outcome: list my videos, preview content, download output files, inspect delivery queue

### L2 内容管理

- Core: `approve`, `review`, `edit-copy`, `published`, `feedback`
- Brand support: `brand-list`, `brand-get`, `brand-update`, `brand-assets`, `account`, `balance`
- User-facing aliases: `caption-update`, `mark-published`
- Outcome: edit captions, close publishing loop, maintain brand material

### L3 数据查询

- Core: `stats`, `analytics-overview`, `analytics-content`, `analytics-top`, `analytics-seo`, `analytics-report`, `competitors-trending`, `audit-log`
- User-facing aliases: `my-stats`, `competitor-report`
- Outcome: show my stats, pull content reports, inspect competitor trend signals

### L4 生产控制

- Core: `create-task`, `task-update`, `task-cancel`, `task-retry`, `task-timeline`
- Style/pipeline: `style-preferences`, `pipeline-list`, `pipeline-get`, `pipeline-create`, `pipeline-update`, `pipeline-preferences`, `pipeline-bind-group`
- Campaign: `campaign-list`, `campaign-create`, `campaign-get`, `campaign-videos`, `campaign-update`, `campaign-delete`
- User-facing aliases: `task-create`, `adjust-style`
- Outcome: create task, adjust style, manage pipeline and campaign orchestration

## Workflow

1. New agent session: run `node --experimental-strip-types ./scripts/mediaclaw-client.ts register "$MEDIACLAW_AGENT_ID"` once.
2. Sync capability matrix with `node --experimental-strip-types ./scripts/mediaclaw-client.ts discover --agent "$MEDIACLAW_AGENT_ID"` and keep liveness via `heartbeat`.
3. Review incoming work with `pending` or `deliveries`, then use `preview` before `download`.
4. Use `approve` or `review` according to the current approval level.
5. Use `caption-update` / `edit-copy` for copy revision and `mark-published` / `published` after external posting completes.
6. Query `my-stats`, `analytics-*`, and `competitor-report` for reporting workflows.
7. Use `task-create`, `adjust-style`, `pipeline-*`, and `campaign-*` for orchestration workflows.
8. After external publishing is complete, call `published` to close the loop in MediaClaw.
9. For command payload examples, read `references/few-shot.md`.
10. For field definitions and task enums, read `references/data-model.md`.

## OpenClaw Example

```json
{
  "name": "mediaclaw-client",
  "command": "node",
  "args": ["--experimental-strip-types", "./scripts/mediaclaw-client.ts"],
  "endpoint": {
    "baseUrl": "${MEDIACLAW_BASE_URL:-https://api.mediaclaw.com}"
  },
  "autoCheck": {
    "enabled": true,
    "intervalSeconds": 300,
    "command": "heartbeat --agent ${MEDIACLAW_AGENT_ID}"
  },
  "downloadDir": "${MEDIACLAW_DOWNLOAD_DIR:-./downloads/mediaclaw}",
  "notification": {
    "onDelivery": true,
    "onApprovalRequired": true,
    "onPublished": true
  }
}
```

The standalone example is also available at `references/openclaw.example.json`.

## Command Entry

Use `node --experimental-strip-types ./scripts/mediaclaw-client.ts help` to inspect the full command matrix.
