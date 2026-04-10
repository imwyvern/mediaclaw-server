# MediaClaw Client Data Model

## Environment Contract

- `MEDIACLAW_API_KEY`: required bearer token for all API calls, format `mc_live_xxx` or `mc_test_xxx`
- `MEDIACLAW_BASE_URL`: optional API origin, defaults to `https://api.mediaclaw.com`
- `MEDIACLAW_AGENT_ID`: optional agent id for skill registration, capability discovery, heartbeat, delivery polling, and feedback submission
- `MEDIACLAW_CLIENT_VERSION`: optional version string reported by `heartbeat`
- `MEDIACLAW_AGENT_CAPABILITIES`: optional comma-separated capability fallback used by `heartbeat`
- `MEDIACLAW_DOWNLOAD_DIR`: optional default directory for downloaded videos

## Core Routes

### Skill Endpoints

- `POST /api/v1/skill/register`
- `GET /api/v1/skill/config?agentId=<id>`
- `GET /api/v1/skill/capabilities?agentId=<id>`
- `GET /api/v1/skill/deliveries?agentId=<id>`
- `POST /api/v1/skill/confirm-delivery`
- `POST /api/v1/skill/feedback`
- `POST /api/v1/heartbeat`

### Content Endpoints

- `GET /api/v1/content`
- `GET /api/v1/content/pending`
- `GET /api/v1/content/:id`
- `PATCH /api/v1/content/:id/copy`
- `POST /api/v1/content/:id/approve`
- `POST /api/v1/content/:id/review`
- `POST /api/v1/content/:id/published`

### Analytics And Account

- `GET /api/v1/account/info`
- `GET /api/v1/usage/summary`
- `GET /api/v1/analytics/overview`
- `GET /api/v1/analytics/content/:id`
- `GET /api/v1/analytics/trends?period=daily|weekly|monthly`
- `GET /api/v1/analytics/top`
- `GET /api/v1/analytics/seo`
- `POST /api/v1/analytics/report`
- `GET /api/v1/audit-logs`
- `GET /api/v1/discovery/pool`

### Task Scheduling

- `POST /api/v1/tasks`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:id`
- `PATCH /api/v1/tasks/:id`
- `POST /api/v1/tasks/:id/cancel`
- `POST /api/v1/tasks/:id/retry`
- `GET /api/v1/tasks/timeline/:id`

### Video Production

- `POST /api/v1/videos`
- `GET /api/v1/videos`
- `GET /api/v1/videos/:id`
- `PATCH /api/v1/videos/:id/copy`
- `PATCH /api/v1/videos/:id/publish`
- `POST /api/v1/videos/batch`
- `GET /api/v1/videos/batch/:id`

### Brand, Pipeline, Campaign

- `GET /api/v1/brand`
- `GET /api/v1/brand/:id`
- `PATCH /api/v1/brand/:id`
- `PATCH /api/v1/brand/:id/assets`
- `GET /api/v1/pipelines`
- `GET /api/v1/pipelines/:id`
- `POST /api/v1/pipelines`
- `PATCH /api/v1/pipelines/:id`
- `PATCH /api/v1/pipelines/:id/preferences`
- `PATCH /api/v1/pipelines/:id/bind-group`
- `GET /api/v1/campaigns`
- `POST /api/v1/campaigns`
- `GET /api/v1/campaigns/:id`
- `GET /api/v1/campaigns/:id/videos`
- `PATCH /api/v1/campaigns/:id`
- `DELETE /api/v1/campaigns/:id`

### Webhooks, Notifications, API Keys

- `GET /api/v1/webhooks`
- `POST /api/v1/webhooks`
- `PATCH /api/v1/webhooks/:id`
- `DELETE /api/v1/webhooks/:id`
- `GET /api/v1/notifications`
- `POST /api/v1/notifications`
- `PATCH /api/v1/notifications/:id`
- `DELETE /api/v1/notifications/:id`
- `GET /api/v1/settings/api-keys`
- `POST /api/v1/settings/api-keys`
- `DELETE /api/v1/settings/api-keys/:provider`
- `POST /api/v1/settings/api-keys/:provider/validate`
- `GET /api/v1/apikey`
- `POST /api/v1/apikey`
- `POST /api/v1/apikey/validate`
- `DELETE /api/v1/apikey/:id`

### Export

- `POST /api/v1/export/report`
- `format`: `csv` / `json` / `pdf` / `excel` / `zip`
- `zip` 模式使用 `reports[]` 打包多份报表，并附带 `manifest.json`

## Enum Contract

### `VideoTaskStatus`

- `draft`
- `pending`
- `analyzing`
- `editing`
- `rendering`
- `quality_check`
- `generating_copy`
- `completed`
- `pending_review`
- `approved`
- `rejected`
- `published`
- `failed`
- `cancelled`

### `VideoTaskType`

- `brand_replace`
- `remix`
- `new_content`

### Review Actions

- `approve`
- `reject`
- `changes_requested`

## Content Payload Shape

```json
{
  "id": "67e8f9ab1234567890fedcba",
  "brandId": "67e8f81234567890fedc001",
  "pipelineId": "67e8f81234567890fedc002",
  "taskType": "new_content",
  "status": "pending_review",
  "outputVideoUrl": "https://cdn.example.com/video.mp4",
  "copy": {
    "title": "示例标题",
    "subtitle": "示例副标题",
    "hashtags": ["#AIGC", "#增长"],
    "blueWords": ["限时策略"],
    "commentGuide": "评论区回复【模板】领取资料",
    "commentGuides": ["评论区回复【模板】领取资料"]
  },
  "approval": {
    "currentLevel": 1,
    "maxLevel": 2,
    "pendingRoles": ["editor"],
    "lastAction": "submitted"
  },
  "publishInfo": {
    "platform": "tiktok",
    "publishUrl": "https://www.tiktok.com/@brand/video/1234567890"
  },
  "publishedAt": null
}
```

## Suggested Client Behavior

- Start each agent session with `register`, then call `discover` to align the L1-L4 capability map.
- Use `heartbeat` as the default auto-check command so the server can push pending queue work and config updates.
- Use `pending` for reviewer-specific queues.
- Use `deliveries` when the client acts as a pull-based delivery agent.
- Always `preview` before `download all` in bulk workflows.
- Use `published` to close the publishing loop instead of writing distribution fields directly.
