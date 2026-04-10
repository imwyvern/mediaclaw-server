# MediaClaw Client Few-Shot

## Session Bootstrap

Goal: 初始化一个新的本地 agent，会接收投递、审核内容并拉取统计。

```bash
export MEDIACLAW_BASE_URL="https://api.mediaclaw.com"
export MEDIACLAW_API_KEY="mc_live_xxx"
# 或测试环境：export MEDIACLAW_API_KEY="mc_test_xxx"
export MEDIACLAW_AGENT_ID="editor-mbp-01"
export MEDIACLAW_AGENT_CAPABILITIES="delivery,review,analytics,pipeline,campaign"
./scripts/mc-api.sh register "$MEDIACLAW_AGENT_ID" delivery review analytics scheduling
./scripts/mc-api.sh discover --agent "$MEDIACLAW_AGENT_ID"
./scripts/mc-api.sh heartbeat --agent "$MEDIACLAW_AGENT_ID"
./scripts/mc-api.sh config --agent "$MEDIACLAW_AGENT_ID"
```

## Review Pending Content

Goal: 查看当前审核人待处理的内容，预览其中一个任务并通过审核。

```bash
./scripts/mc-api.sh pending
./scripts/mc-api.sh preview 67e8f9ab1234567890fedcba
./scripts/mc-api.sh approve 67e8f9ab1234567890fedcba --comment "文案和成片可发布"
```

## Multi-Level Review

Goal: 二级审核人不同意当前版本，退回并要求补充评论引导语。

```bash
./scripts/mc-api.sh review 67e8f9ab1234567890fedcba \
  --action changes_requested \
  --comment "补充评论引导语，并弱化标题里的夸张词。"

./scripts/mc-api.sh edit-copy 67e8f9ab1234567890fedcba \
  --title "3 个提高留资率的短视频开场" \
  --hashtag "#AIGC" \
  --hashtag "#短视频增长" \
  --blue-word "私信模板" \
  --comment-guide "评论区回复【模板】领取话术" \
  --comment-guide "想看拆解版留言【继续】"
```

## Delivery And Download

Goal: 作为客户端 agent 拉取尚未确认的投递，并下载最新视频到本地目录。

```bash
./scripts/mc-api.sh deliveries --agent "$MEDIACLAW_AGENT_ID"
./scripts/mc-api.sh download 67e8f9ab1234567890fedcba --dir ./downloads/mediaclaw
./scripts/mc-api.sh confirm-delivery 67e8f9ab1234567890fedcba --agent "$MEDIACLAW_AGENT_ID"
```

## Publish And Feedback

Goal: 内容已在外部平台发布，回写发布信息，并提交 agent 反馈数据。

```bash
./scripts/mc-api.sh published 67e8f9ab1234567890fedcba \
  --platform tiktok \
  --url "https://www.tiktok.com/@brand/video/1234567890"

./scripts/mc-api.sh feedback 67e8f9ab1234567890fedcba \
  --agent "$MEDIACLAW_AGENT_ID" \
  --json '{"score": 4.7, "notes": "前 3 秒保留率明显更高", "preferredStyles": ["hook_fast"], "avoidStyles": ["slow_intro"]}'
```

## Metrics And Task Scheduling

Goal: 查询周趋势，并创建一个新内容任务。

```bash
./scripts/mc-api.sh stats --period weekly
./scripts/mc-api.sh analytics-top --metric engagementRate --limit 5 --days 30
./scripts/mc-api.sh competitors-trending --industry beauty --limit 10

./scripts/mc-api.sh create-task \
  --type new_content \
  --brand-id 67e8f81234567890fedc001 \
  --pipeline-id 67e8f81234567890fedc002 \
  --source-url "https://cdn.example.com/source/demo.mp4" \
  --metadata '{"brief":"生成一条 15 秒 AI 工具测评视频","campaign":"spring-launch"}'
```

## Brand And Pipeline Operations

Goal: 查看品牌配置，更新素材，并绑定一个新的 IM 群分发规则。

```bash
./scripts/mc-api.sh brand-list
./scripts/mc-api.sh brand-get 67e8f81234567890fedc001
./scripts/mc-api.sh brand-assets 67e8f81234567890fedc001 \
  --logo-url "https://cdn.example.com/brand/logo.png" \
  --reference-image "https://cdn.example.com/brand/ref-1.png" \
  --reference-image "https://cdn.example.com/brand/ref-2.png"

./scripts/mc-api.sh pipeline-list
./scripts/mc-api.sh pipeline-bind-group 67e8f81234567890fedc002 \
  --json '{"groupId":"wecom-group-01","channel":"wecom","sessionId":"S_10086"}'
```

## Campaign Lifecycle

Goal: 创建 Campaign，查看对应视频，再更新排期。

```bash
./scripts/mc-api.sh campaign-create \
  --json '{"name":"618大促","goal":"预热期 15 条种草视频","brandId":"67e8f81234567890fedc001","status":"draft"}'

./scripts/mc-api.sh campaign-list --status draft
./scripts/mc-api.sh campaign-videos 67e8f81234567890fedc010
./scripts/mc-api.sh campaign-update 67e8f81234567890fedc010 \
  --json '{"status":"active","metadata":{"phase":"warmup"}}'
```
