# MediaClaw Client Few-Shot

## Session Bootstrap

Goal: 初始化一个新的本地 agent，会接收投递、审核内容并拉取统计。

```bash
export MEDIACLAW_BASE_URL="https://api.mediaclaw.com"
export MEDIACLAW_API_KEY="mc_live_xxx"
export MEDIACLAW_AGENT_ID="editor-mbp-01"
./scripts/mc-api.sh register "$MEDIACLAW_AGENT_ID" delivery review analytics scheduling
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

./scripts/mc-api.sh create-task \
  --type new_content \
  --brand-id 67e8f81234567890fedc001 \
  --pipeline-id 67e8f81234567890fedc002 \
  --source-url "https://cdn.example.com/source/demo.mp4" \
  --metadata '{"brief":"生成一条 15 秒 AI 工具测评视频","campaign":"spring-launch"}'
```
