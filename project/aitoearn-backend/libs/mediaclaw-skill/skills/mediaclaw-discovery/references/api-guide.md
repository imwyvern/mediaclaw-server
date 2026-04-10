# MediaClaw Discovery Skill API Guide

本 Skill 默认调用线上 `https://mediaclawbot.com`，也可通过 `MEDIACLAW_API_URL` 指向其他环境。

## 鉴权

- Header: `Authorization: Bearer $MEDIACLAW_API_KEY`
- Header: `Accept: application/json`

## 1. 爆款池

- `GET /api/v1/discovery/pool?limit=5&industry=美妆`
- 用途：查询行业爆款素材池
- 关键返回：
  - `items[]`
  - `items[].contentId`
  - `items[].title`
  - `items[].platform`
  - `items[].viralScore`
  - `items[].views/likes/comments/shares`

## 2. 竞品热点

- `GET /api/v1/competitors/hot?limit=5`
- 用途：返回热点竞品内容榜单

## 3. 行业趋势

- `GET /api/v1/competitors/trending?industry=食品饮料`
- 用途：返回行业热点趋势
- 说明：`industry` 为必填

## 4. 爆款拆解

- `POST /api/v1/discovery/remix-analyze`
- Body:

```json
{
  "videoUrl": "https://www.bilibili.com/video/BVxxxx"
}
```

- 用途：输出 5 维分析和 `video recipe`
- 关键返回：
  - `contentId`
  - `analysis`
  - `recipe`

## 5. 生成品牌混剪 Brief

- `POST /api/v1/discovery/generate-remix-brief`
- Body:

```json
{
  "contentId": "viral-content-id",
  "brandId": "brand-id"
}
```

- 用途：基于已分析的爆款内容和品牌配置生成品牌化 brief
- 说明：Skill 会先调用 `remix-analyze` 拿到 `contentId`，若已配置 `MEDIACLAW_BRAND_ID`，再继续调用该接口。

## 推荐环境变量

- `MEDIACLAW_API_URL=https://mediaclawbot.com`
- `MEDIACLAW_API_KEY=mc_live_xxx`
- `MEDIACLAW_INDUSTRY=美妆`
- `MEDIACLAW_BRAND=你的品牌名`
- `MEDIACLAW_BRAND_ID=brand-id`
