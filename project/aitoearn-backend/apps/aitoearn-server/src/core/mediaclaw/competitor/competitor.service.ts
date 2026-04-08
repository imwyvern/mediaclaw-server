import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand, Competitor, Organization, ViralContent } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import {
  SearchVideoSummary,
  TikHubService,
} from '../acquisition/tikhub.service'
import { DiscoveryService } from '../discovery/discovery.service'

type Identifier = Types.ObjectId | string | { toString: () => string }

type LeanCompetitor = Competitor & {
  _id: Identifier
  orgId: Identifier
}

type LeanBrand = Brand & {
  _id: Identifier
  orgId: Identifier
}

type LeanOrganization = Organization & {
  _id: Identifier
}

type LeanViralContent = ViralContent & {
  _id: Identifier
}

interface CompetitorSyncContext {
  industry: string
  keywords: string[]
  searchTerms: string[]
}

@Injectable()
export class CompetitorService {
  constructor(
    @InjectModel(Competitor.name)
    private readonly competitorModel: Model<Competitor>,
    @InjectModel(ViralContent.name)
    private readonly viralContentModel: Model<ViralContent>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly tikHubService: TikHubService,
    private readonly discoveryService: DiscoveryService,
  ) {}

  async addCompetitor(orgId: string, platform: string, accountUrl: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedPlatform = platform?.trim().toLowerCase()
    const normalizedUrl = accountUrl?.trim()

    if (!normalizedPlatform) {
      throw new BadRequestException('platform is required')
    }
    if (!normalizedUrl) {
      throw new BadRequestException('accountUrl is required')
    }

    const profile = this.parseAccountProfile(normalizedUrl)

    const competitor = await this.competitorModel.findOneAndUpdate(
      {
        orgId: normalizedOrgId,
        platform: normalizedPlatform,
        accountUrl: normalizedUrl,
      },
      {
        $set: {
          accountId: profile.accountId,
          accountName: profile.accountName,
          lastSyncedAt: new Date(),
          isActive: true,
        },
        $setOnInsert: {
          orgId: normalizedOrgId,
          platform: normalizedPlatform,
          accountUrl: normalizedUrl,
          metrics: {
            followers: 0,
            avgViews: 0,
            avgLikes: 0,
            postFrequency: 0,
          },
        },
      },
      {
        new: true,
        upsert: true,
      },
    ).lean().exec() as unknown as LeanCompetitor | null

    if (!competitor) {
      throw new NotFoundException('Competitor not found')
    }

    const sync = await this.syncCompetitorRecord(competitor)

    return {
      ...this.toCompetitorResponse(competitor),
      sync,
    }
  }

  async listCompetitors(orgId: string) {
    const competitors = await this.competitorModel
      .find({
        orgId: this.toObjectId(orgId, 'orgId'),
        isActive: true,
      })
      .sort({ lastSyncedAt: -1, createdAt: -1 })
      .lean()
      .exec()

    return competitors.map(item => ({
      ...this.toCompetitorResponse(item as unknown as LeanCompetitor),
    }))
  }

  async getIndustryHot(industry: string, platform?: string, period = '7d') {
    const query: Record<string, any> = {}
    const normalizedIndustry = industry?.trim()
    const normalizedPlatform = platform?.trim().toLowerCase()

    if (normalizedIndustry) {
      query['industry'] = normalizedIndustry
    }
    if (normalizedPlatform) {
      query['platform'] = normalizedPlatform
    }

    query['discoveredAt'] = {
      $gte: this.resolvePeriodStart(period),
    }

    const items = await this.viralContentModel
      .find(query)
      .sort({ viralScore: -1, discoveredAt: -1 })
      .limit(20)
      .lean()
      .exec()

    return {
      industry: normalizedIndustry || null,
      platform: normalizedPlatform || null,
      period,
      source: 'industry_pool',
      items: items.map(item => ({
        id: item._id.toString(),
        platform: item.platform,
        videoId: item.videoId,
        title: item.title,
        author: item.author,
        viralScore: item.viralScore,
        views: item.views,
        likes: item.likes,
        comments: item.comments,
        shares: item.shares,
        contentUrl: item.contentUrl,
        thumbnailUrl: item.thumbnailUrl,
        discoveredAt: item.discoveredAt,
      })),
    }
  }

  async getCompetitorHot(
    orgId: string,
    period = '7d',
    limit = 5,
    platform?: string,
  ) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedLimit = Math.min(
      Math.max(Math.trunc(Number(limit) || 5), 1),
      20,
    )
    const normalizedPlatform = platform?.trim().toLowerCase()
    const competitors = (await this.competitorModel
      .find({
        orgId: normalizedOrgId,
        isActive: true,
        ...(normalizedPlatform ? { platform: normalizedPlatform } : {}),
      })
      .sort({ lastSyncedAt: -1, createdAt: -1 })
      .lean()
      .exec()) as unknown as LeanCompetitor[]

    if (competitors.length === 0) {
      return {
        orgId,
        period,
        platform: normalizedPlatform || null,
        totalCompetitors: 0,
        matchedCompetitors: 0,
        totalItems: 0,
        items: [],
      }
    }

    const query: Record<string, any> = {
      discoveredAt: { $gte: this.resolvePeriodStart(period) },
    }
    if (normalizedPlatform) {
      query['platform'] = normalizedPlatform
    }

    const candidates = (await this.viralContentModel
      .find(query)
      .sort({ viralScore: -1, discoveredAt: -1 })
      .limit(Math.min(Math.max(normalizedLimit * 20, 40), 200))
      .lean()
      .exec()) as unknown as LeanViralContent[]

    const groups = competitors
      .map((competitor) => {
        const items = candidates
          .filter(item => this.matchesCompetitorContent(item, competitor))
          .slice(0, normalizedLimit)

        if (items.length === 0) {
          return null
        }

        return {
          competitor: this.toCompetitorResponse(competitor),
          totalItems: items.length,
          topViralScore: items[0]?.viralScore || 0,
          items: items.map(item => ({
            id: item._id.toString(),
            platform: item.platform,
            videoId: item.videoId,
            title: item.title,
            author: item.author,
            viralScore: item.viralScore,
            views: item.views,
            likes: item.likes,
            comments: item.comments,
            shares: item.shares,
            industry: item.industry,
            keywords: item.keywords,
            contentUrl: item.contentUrl,
            thumbnailUrl: item.thumbnailUrl,
            discoveredAt: item.discoveredAt,
            publishedAt: item.publishedAt,
          })),
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => right.topViralScore - left.topViralScore)

    return {
      orgId,
      period,
      platform: normalizedPlatform || null,
      totalCompetitors: competitors.length,
      matchedCompetitors: groups.length,
      totalItems: groups.reduce((sum, item) => sum + item.totalItems, 0),
      items: groups,
    }
  }

  async syncCompetitor(orgId: string, id: string) {
    const competitor = (await this.competitorModel
      .findOne({
        _id: this.toObjectId(id, 'id'),
        orgId: this.toObjectId(orgId, 'orgId'),
        isActive: true,
      })
      .lean()
      .exec()) as unknown as LeanCompetitor | null

    if (!competitor) {
      throw new NotFoundException('Competitor not found')
    }

    const sync = await this.syncCompetitorRecord(competitor)

    return {
      ...this.toCompetitorResponse(competitor),
      sync,
    }
  }

  async removeCompetitor(orgId: string, id: string) {
    const competitor = await this.competitorModel
      .findOneAndUpdate(
        {
          _id: this.toObjectId(id, 'id'),
          orgId: this.toObjectId(orgId, 'orgId'),
        },
        { isActive: false },
        { new: true },
      )
      .lean()
      .exec()

    if (!competitor) {
      throw new NotFoundException('Competitor not found')
    }

    return {
      id: competitor._id.toString(),
      removed: true,
    }
  }

  private parseAccountProfile(accountUrl: string) {
    let pathname = accountUrl

    try {
      pathname = new URL(accountUrl).pathname
    }
    catch {
      pathname = accountUrl
    }

    const accountId = pathname
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean)
      .at(-1) || 'unknown'

    return {
      accountId,
      accountName: accountId.replace(/[-_]/g, ' '),
    }
  }

  private async syncCompetitorRecord(competitor: LeanCompetitor) {
    const context = await this.resolveSyncContext(competitor)
    const collectedItems: SearchVideoSummary[] = []
    const sources = new Set<string>()
    let scannedCount = 0

    for (const term of context.searchTerms) {
      const response = await this.tikHubService.searchVideos(
        competitor.platform,
        term,
        10,
      )
      sources.add(response.source)
      scannedCount += response.items.length

      const matchedItems = response.items.filter(item =>
        this.matchesCompetitorContent(item, competitor),
      )
      const preferredItems = matchedItems.length > 0 ? matchedItems : response.items
      collectedItems.push(...preferredItems)
    }

    const uniqueItems = this.uniqueVideos(collectedItems)
    if (uniqueItems.length === 0) {
      await this.touchCompetitorSync(competitor._id.toString())

      return {
        platform: competitor.platform,
        industry: context.industry,
        keywords: context.keywords,
        searchTerms: context.searchTerms,
        source: Array.from(sources).filter(Boolean),
        searchScannedCount: scannedCount,
        matchedCount: 0,
        upsertedCount: 0,
        pendingCount: 0,
        contentIds: [],
      }
    }

    const ingestResult = await this.discoveryService.ingestSearchResults({
      platform: competitor.platform,
      industry: context.industry,
      keywords: context.keywords,
      items: uniqueItems,
    })
    await this.touchCompetitorSync(competitor._id.toString())
    const {
      platform: syncedPlatform,
      industry: syncedIndustry,
      ...persisted
    } = ingestResult

    return {
      platform: syncedPlatform,
      industry: syncedIndustry,
      ...persisted,
      keywords: context.keywords,
      searchTerms: context.searchTerms,
      source: Array.from(sources).filter(Boolean),
      searchScannedCount: scannedCount,
      matchedCount: uniqueItems.length,
    }
  }

  private async resolveSyncContext(
    competitor: LeanCompetitor,
  ): Promise<CompetitorSyncContext> {
    const orgObjectId = new Types.ObjectId(competitor.orgId.toString())
    const [brands, organization] = await Promise.all([
      this.brandModel
        .find({
          orgId: orgObjectId,
          isActive: true,
        })
        .sort({ createdAt: 1 })
        .lean()
        .exec() as unknown as Promise<LeanBrand[]>,
      this.organizationModel
        .findById(orgObjectId)
        .lean()
        .exec() as unknown as Promise<LeanOrganization | null>,
    ])

    const brandIndustries = brands
      .map(item => this.normalizeText(item.industry))
      .filter(Boolean)
    const orgIndustry = this.extractOrgIndustry(organization)
    const accountTokens = this.buildCompetitorTokens(competitor)
    const industry
      = brandIndustries[0]
        || orgIndustry
        || accountTokens.find(item => item.length >= 2)
        || competitor.platform

    return {
      industry,
      keywords: this.mergeKeywords(
        brands.flatMap(item => item.assets?.keywords || []),
        [...brandIndustries, orgIndustry, ...accountTokens],
      ),
      searchTerms: this.resolveSearchTerms(competitor),
    }
  }

  private resolveSearchTerms(competitor: LeanCompetitor) {
    const primaryTerms = this.mergeKeywords(
      [competitor.accountId, competitor.accountName],
      [],
    )
      .filter(item => this.isMeaningfulToken(item))

    if (primaryTerms.length > 0) {
      return primaryTerms.slice(0, 2)
    }

    return this.buildCompetitorTokens(competitor)
      .filter(item => this.isMeaningfulToken(item))
      .slice(0, 3)
  }

  private matchesCompetitorContent(
    item: Pick<SearchVideoSummary, 'author' | 'title' | 'contentUrl'>
      | Pick<LeanViralContent, 'author' | 'title' | 'contentUrl'>,
    competitor: LeanCompetitor,
  ) {
    const tokens = this.buildCompetitorTokens(competitor)
    if (tokens.length === 0) {
      return false
    }

    const rawSource = [item.author, item.title, item.contentUrl]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    const compactSource = this.compactText(rawSource)

    return tokens.some((token) => {
      const rawToken = token.toLowerCase()
      const compactToken = this.compactText(rawToken)
      return rawSource.includes(rawToken)
        || (compactToken.length >= 2 && compactSource.includes(compactToken))
    })
  }

  private buildCompetitorTokens(competitor: LeanCompetitor) {
    const profile = this.parseAccountProfile(competitor.accountUrl)
    const compactAccountId = this.compactText(competitor.accountId || '')
    const compactAccountName = this.compactText(competitor.accountName || '')

    return this.mergeKeywords(
      [
        competitor.accountId,
        competitor.accountName,
        profile.accountId,
        profile.accountName,
        compactAccountId,
        compactAccountName,
      ],
      [],
    )
      .filter(item => item.length >= 4)
  }

  private uniqueVideos(items: SearchVideoSummary[]) {
    const videoMap = new Map<string, SearchVideoSummary>()
    for (const item of items) {
      const key = `${item.platform}:${item.videoId}`
      if (!videoMap.has(key)) {
        videoMap.set(key, item)
      }
    }

    return Array.from(videoMap.values())
  }

  private async touchCompetitorSync(id: string) {
    await this.competitorModel
      .findByIdAndUpdate(id, {
        $set: {
          lastSyncedAt: new Date(),
        },
      })
      .exec()
  }

  private extractOrgIndustry(org?: LeanOrganization | null) {
    const rawIndustry = org?.settings?.['industry']
    if (typeof rawIndustry === 'string') {
      return this.normalizeText(rawIndustry)
    }

    if (Array.isArray(rawIndustry)) {
      const firstIndustry = rawIndustry.find(item => typeof item === 'string')
      return this.normalizeText(firstIndustry || '')
    }

    return ''
  }

  private mergeKeywords(primary: string[], secondary: string[]) {
    return Array.from(
      new Set(
        [...primary, ...secondary]
          .map(item => this.normalizeText(item))
          .filter(Boolean),
      ),
    )
  }

  private compactText(value: string) {
    return value.replace(/[^\p{L}\p{N}]+/gu, '')
  }

  private normalizeText(value?: string | null) {
    return value?.trim() || ''
  }

  private isMeaningfulToken(value?: string | null) {
    const normalized = this.normalizeText(value).toLowerCase()
    if (normalized.length < 2) {
      return false
    }

    return !new Set([
      'http',
      'https',
      'www',
      'com',
      'cn',
      'user',
      'users',
      'profile',
      'video',
      'videos',
      'account',
    ]).has(normalized)
  }

  private toCompetitorResponse(item: LeanCompetitor) {
    return {
      id: item._id.toString(),
      orgId: item.orgId.toString(),
      platform: item.platform,
      accountId: item.accountId,
      accountName: item.accountName,
      accountUrl: item.accountUrl,
      metrics: item.metrics,
      lastSyncedAt: item.lastSyncedAt,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }
  }

  private resolvePeriodStart(period: string) {
    const normalized = period?.trim().toLowerCase() || '7d'
    const now = Date.now()
    const periodMap: Record<string, number> = {
      '24h': 1,
      '7d': 7,
      '14d': 14,
      '30d': 30,
      'weekly': 7,
      'monthly': 30,
      'quarterly': 90,
    }

    const days = periodMap[normalized] || Number.parseInt(normalized, 10) || 7
    return new Date(now - (Math.max(1, days) * 24 * 60 * 60 * 1000))
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }
}
