---
name: mediaclaw-client
description: Operates MediaClaw delivery, review, publishing, analytics, and task scheduling workflows from an OpenClaw-style client. Use when the user wants to list pending content, preview or download videos, submit feedback, approve or publish content, query stats, or create MediaClaw tasks.
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

## Capability Map

- `L1 内容交付`: `register`, `config`, `discover`, `heartbeat`, `list`, `pending`, `preview`, `download`, `deliveries`, `confirm-delivery`, `task-list`, `task-status`
- `L2 内容管理`: `approve`, `review`, `edit-copy`, `published`, `feedback`, `brand-list`, `brand-get`, `brand-update`, `brand-assets`, `account`, `balance`
- `L3 数据查询`: `stats`, `analytics-overview`, `analytics-content`, `analytics-top`, `analytics-seo`, `analytics-report`, `competitors-trending`, `audit-log`
- `L4 生产调度`: `create-task`, `task-update`, `task-cancel`, `task-retry`, `task-timeline`, `pipeline-list`, `pipeline-get`, `pipeline-create`, `pipeline-update`, `pipeline-preferences`, `pipeline-bind-group`, `campaign-list`, `campaign-create`, `campaign-get`, `campaign-videos`, `campaign-update`, `campaign-delete`

## Workflow

1. New agent session: run `scripts/mc-api.sh register "$MEDIACLAW_AGENT_ID"` once.
2. Sync capability matrix with `scripts/mc-api.sh discover --agent "$MEDIACLAW_AGENT_ID"` and keep liveness via `heartbeat`.
3. Review incoming work with `pending` or `deliveries`, then use `preview` before `download`.
4. Use `approve` or `review` according to the current approval level.
5. Query `account`, `balance`, `analytics-*`, and `competitors-trending` for reporting workflows.
6. Use `create-task`, `pipeline-*`, and `campaign-*` for orchestration workflows.
7. After external publishing is complete, call `published` to close the loop in MediaClaw.
8. For command payload examples, read `references/few-shot.md`.
9. For field definitions and task enums, read `references/data-model.md`.

## OpenClaw Example

```json
{
  "name": "mediaclaw-client",
  "command": "./scripts/mc-api.sh",
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
    "onApprovalRequired": true
  }
}
```

The standalone example is also available at `references/openclaw.example.json`.

## Command Entry

Use `scripts/mc-api.sh help` to inspect the full command matrix.
