import type {
  TrendingScoutInput,
  TrendingScoutOutput,
  CompetitorReport,
} from '@yikart/mediaclaw-shared-kernel'

/** TikHub 平台端点映射（参考 tikhub.service.ts buildPlatformContract） */
const PLATFORM_SEARCH_ENDPOINTS: Record<string, { method: string; path: string; buildBody: (keyword: string, limit: number) => Record<string, unknown> }> = {
  douyin: {
    method: 'POST',
    path: '/api/v1/douyin/search/fetch_video_search_v2',
    buildBody: (keyword, limit) => ({ keyword, cursor: 0, count: limit, sort_type: '0', publish_time: '0', filter_duration: '0', content_type: '0' }),
  },
  xhs: {
    method: 'GET',
    path: '/api/v1/xiaohongshu/web/search_notes',
    buildBody: (keyword, limit) => ({ keyword, page: 1, sort: 'general', noteType: '_1' }),
  },
  kuaishou: {
    method: 'GET',
    path: '/api/v1/kuaishou/app/search_video_v2',
    buildBody: (keyword, limit) => ({ keyword, page: 1 }),
  },
  bilibili: {
    method: 'GET',
    path: '/api/v1/bilibili/web/search_video',
    buildBody: (keyword, limit) => ({ keyword, page: 1 }),
  },
}

/**
 * 趋势发现 Tool
 *
 * 参考 aitoearn-server/acquisition/tikhub.service.ts
 */
export async function trendingScout(
  input: TrendingScoutInput,
): Promise<TrendingScoutOutput> {
  if (input.mode === 'discover') return discoverTrending(input)
  return competitorAnalysis(input)
}

async function discoverTrending(input: TrendingScoutInput): Promise<TrendingScoutOutput> {
  const apiKey = process.env['TIKHUB_API_KEY']
  if (!apiKey) throw new Error('TIKHUB_API_KEY 未配置')

  const platform = input.platform ?? 'douyin'
  const limit = input.limit ?? 20
  const baseUrl = (process.env['TIKHUB_BASE_URL'] ?? 'https://api.tikhub.io').replace(/\/+$/, '')
  const keyword = input.keyword ?? input.category ?? '热门'

  const config = PLATFORM_SEARCH_ENDPOINTS[platform] ?? PLATFORM_SEARCH_ENDPOINTS['douyin']
  const headers: Record<string, string> = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

  let resp: Response
  if (config.method === 'POST') {
    resp = await fetch(`${baseUrl}${config.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(config.buildBody(keyword, limit)),
    })
  } else {
    const params = new URLSearchParams(config.buildBody(keyword, limit) as Record<string, string>)
    resp = await fetch(`${baseUrl}${config.path}?${params}`, { headers })
  }

  if (!resp.ok) throw Object.assign(new Error(`TikHub API ${resp.status}`), { meta: { errorCode: 'API_DOWN', retryable: true } })

  const data = (await resp.json()) as Record<string, unknown>
  const items = extractVideoItems(data)

  return {
    videos: items.slice(0, limit).map((v) => ({
      url: v.url ?? '', title: v.title ?? '', likes: v.likes, shares: v.shares, styleTags: v.tags,
    })),
  }
}

async function competitorAnalysis(input: TrendingScoutInput): Promise<TrendingScoutOutput> {
  const accounts = input.competitorAccounts ?? []
  if (accounts.length === 0) throw new Error('competitor 模式需要 competitorAccounts')

  const apiKey = process.env['TIKHUB_API_KEY']
  if (!apiKey) throw new Error('TIKHUB_API_KEY 未配置')
  const baseUrl = (process.env['TIKHUB_BASE_URL'] ?? 'https://api.tikhub.io').replace(/\/+$/, '')
  const platform = input.platform ?? 'douyin'

  const newVideos: CompetitorReport['newVideos'] = []
  const allStyles: string[] = []

  for (const account of accounts.slice(0, 5)) {
    // 用搜索 API 查竞品账号的视频
    const config = PLATFORM_SEARCH_ENDPOINTS[platform] ?? PLATFORM_SEARCH_ENDPOINTS['douyin']
    const headers: Record<string, string> = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

    let resp: Response
    if (config.method === 'POST') {
      resp = await fetch(`${baseUrl}${config.path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(config.buildBody(account, 10)),
      })
    } else {
      const params = new URLSearchParams(config.buildBody(account, 10) as Record<string, string>)
      resp = await fetch(`${baseUrl}${config.path}?${params}`, { headers })
    }

    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>
      const items = extractVideoItems(data)
      for (const v of items) {
        newVideos.push({ url: v.url ?? '', postedAt: v.postedAt ?? '', performance: { views: v.views, likes: v.likes, comments: v.comments } })
        allStyles.push(...(v.tags ?? []))
      }
    }
  }

  const styleTrends = [...new Set(allStyles)].slice(0, 10)

  return {
    competitorReport: {
      newVideos,
      styleTrends,
      opportunity: `发现 ${newVideos.length} 条竞品视频，${styleTrends.length} 个风格趋势`,
    },
  }
}

/** 从 TikHub 响应中提取视频列表（兼容多平台格式） */
function extractVideoItems(data: Record<string, unknown>): Array<{
  url?: string; title?: string; likes?: number; shares?: number; comments?: number; views?: number; postedAt?: string; tags?: string[]
}> {
  const container = (data['data'] ?? data) as unknown

  // 扁平数组格式（测试 + 部分平台直接返回）
  if (Array.isArray(container)) {
    return (container as Array<Record<string, unknown>>).map((item) => ({
      url: String(item['url'] ?? item['share_url'] ?? ''),
      title: String(item['title'] ?? item['desc'] ?? ''),
      likes: Number(item['likes'] ?? item['digg_count'] ?? item['like_count'] ?? 0),
      shares: Number(item['shares'] ?? item['share_count'] ?? 0),
      comments: Number(item['comments'] ?? item['comment_count'] ?? 0),
      views: Number(item['views'] ?? item['play_count'] ?? 0),
      postedAt: String(item['postedAt'] ?? item['create_time'] ?? item['published_at'] ?? ''),
      tags: extractTags(item),
    }))
  }

  // 嵌套格式（抖音 aweme_list 等）
  const obj = container as Record<string, unknown>
  const rawList = (obj['aweme_list'] ?? obj['data'] ?? obj['items'] ?? obj['video_list'] ?? []) as Array<Record<string, unknown>>

  return rawList.map((item) => {
    const stats = (item['statistics'] ?? item['stats'] ?? item) as Record<string, unknown>
    const desc = String(item['desc'] ?? item['title'] ?? '')
    const shareUrl = String(item['share_url'] ?? item['url'] ?? '')

    return {
      url: shareUrl,
      title: desc,
      likes: Number(stats['digg_count'] ?? stats['like_count'] ?? stats['likes'] ?? 0),
      shares: Number(stats['share_count'] ?? stats['shares'] ?? 0),
      comments: Number(stats['comment_count'] ?? stats['comments'] ?? 0),
      views: Number(stats['play_count'] ?? stats['views'] ?? 0),
      postedAt: String(item['create_time'] ?? item['published_at'] ?? ''),
      tags: extractTags(item),
    }
  })
}

function extractTags(item: Record<string, unknown>): string[] {
  const textTags = (item['text_extra'] ?? []) as Array<Record<string, unknown>>
  return textTags.map((t) => String(t['hashtag_name'] ?? t['tag_name'] ?? '')).filter(Boolean).slice(0, 10)
}
