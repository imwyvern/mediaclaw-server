---
name: mediaclaw-client
description: Operates MediaClaw delivery, review, publishing, analytics, and task scheduling workflows from an OpenClaw-style client. Use when the user wants to list pending content, preview or download videos, submit feedback, approve or publish content, query stats, or create MediaClaw tasks.
---

# MediaClaw Client

Use this skill when the user needs to operate MediaClaw from a local agent or OpenClaw-compatible client.

## Requirements

- Required env: `MEDIACLAW_API_KEY`
- Optional env: `MEDIACLAW_BASE_URL` (default `https://api.mediaclaw.com`)
- Optional env: `MEDIACLAW_AGENT_ID` for `register`, `config`, `deliveries`, `confirm-delivery`, and `feedback`
- Optional env: `MEDIACLAW_DOWNLOAD_DIR` (default `./downloads/mediaclaw`)
- Runtime dependencies: `curl`, `jq`

## Capability Map

- `L1 内容交付`: `list`, `pending`, `preview`, `download`, `deliveries`, `confirm-delivery`
- `L2 内容管理`: `approve`, `review`, `edit-copy`, `published`, `feedback`
- `L3 数据查询`: `stats`
- `L4 生产调度`: `config`, `create-task`

## Workflow

1. New agent session: run `scripts/mc-api.sh register "$MEDIACLAW_AGENT_ID"` once.
2. Sync local context when needed: run `scripts/mc-api.sh config --agent "$MEDIACLAW_AGENT_ID"`.
3. Review incoming work with `pending` or `deliveries`, then use `preview` before `download`.
4. Use `approve` or `review` according to the current approval level.
5. After external publishing is complete, call `published` to close the loop in MediaClaw.
6. For command payload examples, read `references/few-shot.md`.
7. For field definitions and task enums, read `references/data-model.md`.

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
    "command": "deliveries --agent ${MEDIACLAW_AGENT_ID}"
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
