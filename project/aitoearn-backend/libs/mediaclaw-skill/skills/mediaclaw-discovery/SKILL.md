---
name: mediaclaw-discovery
display_name: MediaClaw 爆款发现
description: 发现你所在行业的爆款短视频，分析为什么火，获取混剪灵感
version: 1.0.0
author: MediaClaw
tags: [video, viral, discovery, marketing, content]
---

# MediaClaw 爆款发现

帮你找到行业里最火的短视频内容，分析爆款密码，生成混剪灵感。

## 能力

### 🔥 爆款推荐

"帮我找最近美妆行业的爆款视频"
→ 返回 viral score 最高的内容，含播放量、点赞、评论、分享数据

### 🔍 竞品监控

"监控竞品账号 @xxx 的最新内容"
→ 追踪竞品发布的内容和表现数据

### 📊 行业趋势

"最近食品饮料行业什么内容最火？"
→ 返回行业热门话题、关键词趋势

### 🧬 爆款拆解

"分析这个视频为什么火" + 视频链接
→ 5 维度拆解：结构 / 画面 / 文案 / 音频 / 数据，输出 video recipe

### 💡 混剪灵感

"基于这个爆款给我生成混剪方案" + 视频链接 + 品牌信息
→ 结合你的品牌资产，生成可执行的混剪 brief；若未配置品牌 ID，则先返回可执行的 recipe 分析

## 配置

安装后需要配置：

- `MEDIACLAW_API_KEY`: 你的 MediaClaw API Key（在 mediaclawbot.com 控制台获取）
- `MEDIACLAW_BRAND`: 你的品牌名称（可选，用于个性化提示）
- `MEDIACLAW_INDUSTRY`: 你的行业（美妆 / 食品饮料 / 3C数码 / 服装 / ...）

高级可选配置：

- `MEDIACLAW_API_URL`: API 地址，默认 `https://mediaclawbot.com`
- `MEDIACLAW_BRAND_ID`: 品牌 ID；若已配置，可直接调用品牌化 remix brief 接口

## 使用示例

> 用户：最近我们美妆行业有什么爆款？
>
> AI：我帮你查了最近 7 天美妆行业的爆款视频，按 viral score 排序：
>
> 🥇 **"3步搞定约会妆"** — 抖音
> - 播放 520万 | 点赞 45万 | 评论 2.3万 | Viral Score: 94
> - 爆款密码：快节奏教程 + 反转对比 + 热门 BGM
>
> 🥈 **"平价替代大牌粉底液测评"** — 小红书
> - 播放 180万 | 点赞 12万 | 收藏 8.5万 | Viral Score: 88
> - 爆款密码：测评对比 + 价格锚点 + 素人真实感
>
> 要我详细拆解哪个？或者基于某个爆款生成你品牌的混剪方案？

## 入口

- 可执行脚本：`./scripts/mediaclaw-discovery`
- API 文档：`./references/api-guide.md`
