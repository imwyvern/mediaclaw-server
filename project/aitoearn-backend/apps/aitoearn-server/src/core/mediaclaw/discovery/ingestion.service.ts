import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Brand,
  Competitor,
  Organization,
  ViralContent,
  ViralContentRemixStatus,
} from '@yikart/mongodb'
import { Queue } from 'bullmq'
import { Model, Types } from 'mongoose'
import { AcquisitionService } from '../acquisition/acquisition.service'
import { TikHubPlatform, TikHubService } from '../acquisition/tikhub.service'
import { DiscoveryNotificationService } from './discovery-notification.service'
import {
  DEFAULT_DISCOVERY_INDUSTRIES,
  DEFAULT_DISCOVERY_PLATFORMS,
  DiscoveryIngestionJobData,
  MEDIACLAW_DISCOVERY_CRON,
  MEDIACLAW_DISCOVERY_JOB,
  MEDIACLAW_DISCOVERY_QUEUE,
  MEDIACLAW_DISCOVERY_SCHEDULER,
} from './discovery.constants'
import { DiscoveryService } from './discovery.service'

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

interface DiscoveryScanPlan {
  orgId: string
  platform: TikHubPlatform
  industry: string
  keywords: string[]
  competitorCount: number
}

interface DiscoveryKeywordScanResult {
  industry: string
  platform: string
  keyword: string
  source: string
  scannedCount: number
  upsertedCount: number
  pendingCount: number
  contentIds: string[]
}

interface DiscoveryRunOptions {
  industries?: string[]
  platforms?: TikHubPlatform[]
  source?: string
}

@Injectable()
export class DiscoveryIngestionService implements OnModuleInit {
  private readonly logger = new Logger(DiscoveryIngestionService.name)
  private readonly searchLimit = 10

  constructor(
    @InjectQueue(MEDIACLAW_DISCOVERY_QUEUE)
    private readonly discoveryQueue: Queue<DiscoveryIngestionJobData>,
    @InjectModel(ViralContent.name)
    private readonly viralContentModel: Model<ViralContent>,
    @InjectModel(Competitor.name)
    private readonly competitorModel: Model<Competitor>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly acquisitionService: AcquisitionService,
    private readonly tikHubService: TikHubService,
    private readonly discoveryService: DiscoveryService,
    private readonly discoveryNotificationService: DiscoveryNotificationService,
  ) {}

  async onModuleInit() {
    await this.discoveryQueue.upsertJobScheduler(
      MEDIACLAW_DISCOVERY_SCHEDULER,
      {
        pattern: MEDIACLAW_DISCOVERY_CRON,
      },
      {
        name: MEDIACLAW_DISCOVERY_JOB,
        data: {
          trigger: 'scheduled',
          industries: [...DEFAULT_DISCOVERY_INDUSTRIES],
          platforms: [...DEFAULT_DISCOVERY_PLATFORMS],
          source: 'bullmq-scheduler',
        },
        opts: {
          removeOnComplete: 20,
          removeOnFail: 20,
        },
      },
    )
  }

  async enqueueScheduledIngestion(data: DiscoveryIngestionJobData = { trigger: 'scheduled' }) {
    const normalizedPlatforms = this.normalizePlatforms(data.platforms)
    const normalizedIndustries = this.normalizeIndustries(data.industries)

    const job = await this.discoveryQueue.add(
      MEDIACLAW_DISCOVERY_JOB,
      {
        trigger: data.trigger || 'scheduled',
        industries: normalizedIndustries,
        platforms: normalizedPlatforms,
        requestedAt: data.requestedAt || new Date().toISOString(),
        source: data.source || 'manual-queue',
      },
      {
        jobId: `${MEDIACLAW_DISCOVERY_JOB}:${Date.now()}`,
      },
    )

    return {
      jobId: String(job.id || ''),
      queueName: MEDIACLAW_DISCOVERY_QUEUE,
      trigger: data.trigger || 'scheduled',
      industries: normalizedIndustries,
      platforms: normalizedPlatforms,
    }
  }

  async runBootstrap(
    industries: string[] = [...DEFAULT_DISCOVERY_INDUSTRIES],
    platforms: TikHubPlatform[] = [...DEFAULT_DISCOVERY_PLATFORMS],
  ) {
    return this.runIngestion({
      industries,
      platforms,
      source: 'bootstrap',
    })
  }

  async processJob(data: DiscoveryIngestionJobData) {
    return this.runIngestion({
      industries: data.industries,
      platforms: data.platforms,
      source: data.source || data.trigger || 'scheduled',
    })
  }

  private async runIngestion(options: DiscoveryRunOptions) {
    const startedAt = new Date()
    const plans = await this.buildScanPlans(options)
    const keywordResults: DiscoveryKeywordScanResult[] = []
    const notifications: Record<string, unknown>[] = []

    this.logger.log(`Discovery ingestion started with ${plans.length} plan(s).`)

    for (const plan of plans) {
      for (const keyword of plan.keywords) {
        const result = await this.scanKeyword(
          plan.platform,
          plan.industry,
          keyword,
          plan.keywords,
        )
        keywordResults.push(result)
      }

      const notification = await this.notifyPendingDiscoveriesForPlan(plan, startedAt)
      if (notification) {
        notifications.push(notification)
      }
    }

    const totalContents = keywordResults.reduce((sum, item) => sum + item.upsertedCount, 0)
    const totalPending = keywordResults.reduce((sum, item) => sum + item.pendingCount, 0)

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      source: options.source || 'manual',
      plans: plans.length,
      keywords: keywordResults.length,
      upserts: totalContents,
      pending: totalPending,
      notifications: notifications.length,
      notificationItems: notifications,
      items: keywordResults,
    }
  }

  private async scanKeyword(
    platform: TikHubPlatform,
    industry: string,
    keyword: string,
    relatedKeywords: string[] = [],
  ): Promise<DiscoveryKeywordScanResult> {
    const normalizedIndustry = this.normalizeText(industry)
    const normalizedKeyword = this.normalizeText(keyword)
    if (!normalizedIndustry || !normalizedKeyword) {
      return {
        industry: normalizedIndustry,
        platform,
        keyword: normalizedKeyword,
        source: 'skipped',
        scannedCount: 0,
        upsertedCount: 0,
        pendingCount: 0,
        contentIds: [],
      }
    }

    const response = await this.acquisitionService.searchVideos(
      platform,
      normalizedKeyword,
      this.searchLimit,
    )
    const deepResponse = response.source === 'tikhub'
      ? await this.tikHubService.searchVideosIncremental(
          platform,
          normalizedKeyword,
          this.searchLimit,
          {
            enrichDepth: 'deep',
            incrementalState: await this.resolveIncrementalState(
              platform,
              normalizedIndustry,
              normalizedKeyword,
            ),
          },
        )
      : response
    const ingestResult = await this.discoveryService.ingestSearchResults({
      platform: deepResponse.platform,
      industry: normalizedIndustry,
      keywords: this.mergeKeywords(relatedKeywords, [
        normalizedIndustry,
        normalizedKeyword,
      ]),
      items: deepResponse.items,
    })

    return {
      ...ingestResult,
      keyword: normalizedKeyword,
      source: deepResponse.source,
    }
  }

  private async resolveIncrementalState(
    platform: TikHubPlatform,
    industry: string,
    keyword: string,
  ) {
    const latest = await this.viralContentModel
      .findOne({
        platform,
        industry,
        keywords: keyword,
      })
      .sort({ discoveredAt: -1, createdAt: -1 })
      .lean()
      .exec() as unknown as LeanViralContent | null

    const state = latest?.acquisitionInsight?.['incrementalState']
    return state && typeof state === 'object'
      ? state as { cursor?: string, watermark?: string, page?: number }
      : undefined
  }

  private async buildScanPlans(options: DiscoveryRunOptions) {
    const defaultPlans = this.buildDefaultPlans(options)
    const scheduledPlans = await this.buildScheduledScanPlans(
      this.normalizePlatforms(options.platforms),
    )
    const planMap = new Map<string, DiscoveryScanPlan>()

    for (const plan of [...defaultPlans, ...scheduledPlans]) {
      this.upsertScanPlan(planMap, plan)
    }

    return Array.from(planMap.values()).filter(plan => Boolean(plan.industry) && plan.keywords.length > 0)
  }

  private buildDefaultPlans(options: DiscoveryRunOptions) {
    const industries = this.normalizeIndustries(options.industries)
    const platforms = this.normalizePlatforms(options.platforms)

    return industries.flatMap((industry) => {
      const keywords = this.mergeKeywords([industry], [])
      return platforms.map(platform => ({
        orgId: 'demo-public',
        platform,
        industry,
        keywords,
        competitorCount: 0,
      }))
    })
  }

  private async buildScheduledScanPlans(platforms: TikHubPlatform[]): Promise<DiscoveryScanPlan[]> {
    const competitors = (await this.competitorModel
      .find({ isActive: true })
      .sort({ lastSyncedAt: -1, createdAt: -1 })
      .lean()
      .exec()) as unknown as LeanCompetitor[]

    if (competitors.length === 0) {
      return []
    }

    const orgIds = Array.from(new Set(competitors.map(item => item.orgId.toString())))
    const [brands, organizations] = await Promise.all([
      this.brandModel
        .find({
          orgId: { $in: orgIds.map(id => new Types.ObjectId(id)) },
          isActive: true,
        })
        .lean()
        .exec() as unknown as Promise<LeanBrand[]>,
      this.organizationModel
        .find({
          _id: { $in: orgIds.map(id => new Types.ObjectId(id)) },
        })
        .lean()
        .exec() as unknown as Promise<LeanOrganization[]>,
    ])

    const brandsByOrgId = new Map<string, LeanBrand[]>()
    for (const brand of brands) {
      const key = brand.orgId.toString()
      const items = brandsByOrgId.get(key) || []
      items.push(brand)
      brandsByOrgId.set(key, items)
    }

    const organizationsById = new Map<string, LeanOrganization>(
      organizations.map(item => [item._id.toString(), item]),
    )

    const planMap = new Map<string, DiscoveryScanPlan>()
    for (const competitor of competitors) {
      const orgId = competitor.orgId.toString()
      const platform = this.normalizePlatform(competitor.platform)
      if (!platform || !platforms.includes(platform)) {
        continue
      }

      const orgBrands = brandsByOrgId.get(orgId) || []
      const orgIndustry = this.extractOrgIndustry(organizationsById.get(orgId))

      if (orgBrands.length > 0) {
        for (const brand of orgBrands) {
          const industry = this.normalizeText(brand.industry) || orgIndustry
          const keywords = this.mergeKeywords(
            brand.assets?.keywords || [],
            industry ? [industry] : [],
          )
          this.upsertScanPlan(planMap, {
            orgId,
            platform,
            industry,
            keywords,
            competitorCount: 1,
          })
        }
        continue
      }

      if (!orgIndustry) {
        continue
      }

      this.upsertScanPlan(planMap, {
        orgId,
        platform,
        industry: orgIndustry,
        keywords: [orgIndustry],
        competitorCount: 1,
      })
    }

    return Array.from(planMap.values())
  }

  private upsertScanPlan(planMap: Map<string, DiscoveryScanPlan>, input: DiscoveryScanPlan) {
    const normalizedIndustry = this.normalizeText(input.industry)
    const normalizedKeywords = this.mergeKeywords(
      input.keywords,
      normalizedIndustry ? [normalizedIndustry] : [],
    )
    if (!normalizedIndustry || normalizedKeywords.length === 0) {
      return
    }

    const key = `${input.orgId}:${input.platform}:${normalizedIndustry}`
    const current = planMap.get(key)
    if (!current) {
      planMap.set(key, {
        ...input,
        industry: normalizedIndustry,
        keywords: normalizedKeywords,
      })
      return
    }

    current.keywords = this.mergeKeywords(current.keywords, normalizedKeywords)
    current.competitorCount += input.competitorCount
  }

  private async notifyPendingDiscoveriesForPlan(plan: DiscoveryScanPlan, startedAt: Date) {
    const items = (await this.viralContentModel
      .find({
        platform: plan.platform,
        industry: this.normalizeText(plan.industry),
        remixStatus: ViralContentRemixStatus.PENDING,
        discoveredAt: { $gte: startedAt },
      })
      .sort({ viralScore: -1, discoveredAt: -1 })
      .lean()
      .exec()) as unknown as LeanViralContent[]

    if (items.length < 3 || plan.orgId === 'demo-public') {
      return null
    }

    return this.discoveryNotificationService.notifyNewDiscoveries(
      plan.orgId,
      items,
    )
  }

  private normalizeIndustries(industries?: string[]) {
    const normalized = this.mergeKeywords(
      industries && industries.length > 0
        ? industries
        : [...DEFAULT_DISCOVERY_INDUSTRIES],
      [],
    )

    return normalized.length > 0
      ? normalized
      : [...DEFAULT_DISCOVERY_INDUSTRIES]
  }

  private normalizePlatforms(platforms?: TikHubPlatform[]) {
    const normalized = Array.from(
      new Set(
        (platforms || DEFAULT_DISCOVERY_PLATFORMS)
          .map(platform => this.normalizePlatform(platform))
          .filter((platform): platform is TikHubPlatform => Boolean(platform)),
      ),
    )

    return normalized.length > 0
      ? normalized
      : [...DEFAULT_DISCOVERY_PLATFORMS]
  }

  private normalizePlatform(platform?: string | null): TikHubPlatform | null {
    const normalizedPlatform = this.normalizeText(platform).toLowerCase()
    return DEFAULT_DISCOVERY_PLATFORMS.includes(normalizedPlatform as TikHubPlatform)
      ? normalizedPlatform as TikHubPlatform
      : null
  }

  private extractOrgIndustry(org?: LeanOrganization) {
    const rawIndustry = org?.settings?.['industry']
    if (typeof rawIndustry === 'string') {
      return this.normalizeText(rawIndustry)
    }

    if (Array.isArray(rawIndustry)) {
      return this.normalizeText(
        rawIndustry.find(item => typeof item === 'string') || '',
      )
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

  private normalizeText(value?: string | null) {
    return value?.trim() || ''
  }
}
