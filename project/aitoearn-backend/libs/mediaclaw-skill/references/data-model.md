# MediaClaw Client Data Model

## Environment Contract

- `MEDIACLAW_API_KEY`: required bearer token for all API calls
- `MEDIACLAW_BASE_URL`: optional API origin, defaults to `https://api.mediaclaw.com`
- `MEDIACLAW_AGENT_ID`: optional agent id for skill registration, delivery polling, and feedback submission
- `MEDIACLAW_DOWNLOAD_DIR`: optional default directory for downloaded videos

## Core Routes

### Skill Endpoints

- `POST /api/v1/skill/register`
- `GET /api/v1/skill/config?agentId=<id>`
- `GET /api/v1/skill/deliveries?agentId=<id>`
- `POST /api/v1/skill/confirm-delivery`
- `POST /api/v1/skill/feedback`

### Content Endpoints

- `GET /api/v1/content`
- `GET /api/v1/content/pending`
- `GET /api/v1/content/:id`
- `PATCH /api/v1/content/:id/copy`
- `POST /api/v1/content/:id/approve`
- `POST /api/v1/content/:id/review`
- `POST /api/v1/content/:id/published`

### Analytics And Account

- `GET /api/v1/account`
- `GET /api/v1/account/usage`
- `GET /api/v1/analytics/overview`
- `GET /api/v1/analytics/trends?period=daily|weekly|monthly`

### Task Scheduling

- `POST /api/v1/tasks`

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

- Use `pending` for reviewer-specific queues.
- Use `deliveries` when the client acts as a pull-based delivery agent.
- Always `preview` before `download all` in bulk workflows.
- Use `published` to close the publishing loop instead of writing distribution fields directly.
