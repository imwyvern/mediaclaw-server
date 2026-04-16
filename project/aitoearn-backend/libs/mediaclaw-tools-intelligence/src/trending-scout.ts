import type {
  TrendingScoutInput,
  TrendingScoutOutput,
  CompetitorReport,
} from '@yikart/mediaclaw-shared-kernel'

/**
 * 趋势发现 Tool
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
  const baseUrl = process.env['TIKHUB_BASE_URL'] ?? 'https://api.tikhub.io'

  const resp = await fetch(`${baseUrl}/api/v1/${platform}/trending?limit=${limit}&days=${input.days ?? 7}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })

  if (!resp.ok) throw Object.assign(new Error(`TikHub API ${resp.status}`), { meta: { errorCode: 'API_DOWN', retryable: true } })

  const data = (await resp.json()) as { data?: Array<{ url?: string; title?: string; likes?: number; shares?: number; tags?: string[] }> }

  return {
    videos: (data.data ?? []).slice(0, limit).map((v) => ({
      url: v.url ?? '', title: v.title ?? '', likes: v.likes, shares: v.shares, styleTags: v.tags,
    })),
  }
}

async function competitorAnalysis(input: TrendingScoutInput): Promise<TrendingScoutOutput> {
  const accounts = input.competitorAccounts ?? []
  if (accounts.length === 0) throw new Error('competitor 模式需要 competitorAccounts')

  const apiKey = process.env['TIKHUB_API_KEY']
  if (!apiKey) throw new Error('TIKHUB_API_KEY 未配置')
  const baseUrl = process.env['TIKHUB_BASE_URL'] ?? 'https://api.tikhub.io'

  const newVideos: CompetitorReport['newVideos'] = []
  const allStyles: string[] = []

  for (const account of accounts.slice(0, 5)) {
    const resp = await fetch(`${baseUrl}/api/v1/account/${account}/videos?days=${input.days ?? 30}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (resp.ok) {
      const data = (await resp.json()) as { data?: Array<{ url?: string; postedAt?: string; views?: number; likes?: number; comments?: number; styles?: string[] }> }
      for (const v of data.data ?? []) {
        newVideos.push({ url: v.url ?? '', postedAt: v.postedAt ?? '', performance: { views: v.views, likes: v.likes, comments: v.comments } })
        allStyles.push(...(v.styles ?? []))
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
