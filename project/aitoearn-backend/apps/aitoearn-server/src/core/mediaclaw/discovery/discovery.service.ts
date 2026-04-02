import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  Brand,
  Competitor,
  Organization,
  VideoTask,
  ViralContent,
  ViralContentRemixStatus,
} from "@yikart/mongodb";
import { Model, Types } from "mongoose";
import {
  SearchVideoSummary,
  TikHubPlatform,
  TikHubService,
} from "../acquisition/tikhub.service";
import { DiscoveryNotificationService } from "./discovery-notification.service";

interface ViralMetricsInput {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  keywords?: string[];
}

interface DiscoveryIngestInput {
  platform: string;
  industry: string;
  keywords: string[];
  items: SearchVideoSummary[];
  discoveredAt?: Date;
}

interface DiscoveryIngestResult {
  industry: string;
  platform: string;
  scannedCount: number;
  upsertedCount: number;
  pendingCount: number;
  contentIds: string[];
}

interface DiscoveryScanPlan {
  orgId: string;
  platform: TikHubPlatform;
  industry: string;
  keywords: string[];
  competitorCount: number;
}

interface DiscoveryKeywordScanResult extends DiscoveryIngestResult {
  keyword: string;
  source: string;
}

type Identifier = Types.ObjectId | string | { toString(): string };

type LeanCompetitor = Competitor & {
  _id: Identifier;
  orgId: Identifier;
};

type LeanBrand = Brand & {
  _id: Identifier;
  orgId: Identifier;
};

type LeanOrganization = Organization & {
  _id: Identifier;
};

type LeanViralContent = ViralContent & {
  _id: Identifier;
};

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly searchLimit = 10;

  constructor(
    @InjectModel(ViralContent.name)
    private readonly viralContentModel: Model<ViralContent>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Competitor.name)
    private readonly competitorModel: Model<Competitor>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly tikHubService: TikHubService,
    private readonly discoveryNotificationService: DiscoveryNotificationService,
  ) {}

  calculateViralScoreLegacy(metrics: ViralMetricsInput) {
    const views = this.normalizeMetric(metrics.views);
    const likes = this.normalizeMetric(metrics.likes);
    const comments = this.normalizeMetric(metrics.comments);
    const shares = this.normalizeMetric(metrics.shares);
    const weightedScore =
      views * 0.3 + likes * 0.25 + comments * 0.25 + shares * 0.2;

    return this.round(Math.min(100, Math.log10(weightedScore + 1) * 20));
  }

  calculateViralScore(
    metrics: ViralMetricsInput,
    publishedAt?: string | Date | null,
    industryKeywords: string[] = [],
  ) {
    const likes = this.normalizeMetric(metrics.likes);
    const comments = this.normalizeMetric(metrics.comments);
    const shares = this.normalizeMetric(metrics.shares);
    const hoursSincePublish = this.resolveHoursSincePublish(publishedAt);
    const engagementVelocity =
      (likes + comments * 3 + shares * 5) / Math.max(hoursSincePublish, 1);
    const timeDecay = 1 / (1 + hoursSincePublish / 24);
    const categoryRelevance = this.calculateKeywordJaccard(
      metrics.keywords || [],
      industryKeywords,
    );

    return this.round(engagementVelocity * timeDecay * categoryRelevance);
  }

  async filterP90(industry: string, platform?: string) {
    const query = this.buildDiscoveryQuery(industry, platform);
    const candidates = await this.viralContentModel
      .find(query)
      .sort({ viralScore: -1, discoveredAt: -1 })
      .lean()
      .exec();

    if (candidates.length === 0) {
      return [];
    }

    const typedCandidates = candidates as unknown as LeanViralContent[];
    if (query["platform"]) {
      return this.selectTopP90(typedCandidates);
    }

    return this.selectGroupedTopP90(typedCandidates);
  }

  async getRecommendationPool(orgId: string, limit = 10, industry?: string) {
    const normalizedLimit = Math.min(
      Math.max(Math.trunc(Number(limit) || 10), 1),
      50,
    );
    const p90Candidates = await this.filterP90(industry || "");
    const orgTaskIds = await this.getOrgTaskIds(orgId);
    const excludedTaskIds = new Set(orgTaskIds);

    const pool = p90Candidates
      .filter((item) => {
        if (item.remixStatus !== ViralContentRemixStatus.PENDING) {
          return false;
        }

        if (!item.remixTaskId) {
          return true;
        }

        return !excludedTaskIds.has(item.remixTaskId.toString());
      })
      .slice(0, normalizedLimit)
      .map((item) => ({
        contentId: item._id.toString(),
        platform: item.platform,
        videoId: item.videoId,
        title: item.title,
        author: item.author,
        viralScore: item.viralScore,
        industry: item.industry,
        keywords: item.keywords,
        contentUrl: item.contentUrl,
        thumbnailUrl: item.thumbnailUrl,
        discoveredAt: item.discoveredAt,
        publishedAt: item.publishedAt,
      }));

    return {
      orgId,
      total: pool.length,
      source: pool.length > 0 ? "p90" : "empty",
      items: pool,
    };
  }

  async markRemixed(contentId: string, taskId: string) {
    if (!Types.ObjectId.isValid(contentId)) {
      throw new NotFoundException("Viral content not found");
    }

    const taskObjectId = Types.ObjectId.isValid(taskId)
      ? new Types.ObjectId(taskId)
      : null;
    const brandId = await this.resolveTaskBrandId(taskObjectId);
    const content = await this.viralContentModel
      .findByIdAndUpdate(
        contentId,
        {
          $set: {
            remixStatus: ViralContentRemixStatus.REMIXED,
            remixTaskId: taskObjectId,
          },
          $push: {
            remixHistory: {
              brandId,
              taskId: taskObjectId,
              remixedAt: new Date(),
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!content) {
      throw new NotFoundException("Viral content not found");
    }

    return content;
  }

  async scanKeyword(
    platform: string,
    industry: string,
    keyword: string,
    relatedKeywords: string[] = [],
  ): Promise<DiscoveryKeywordScanResult> {
    const normalizedIndustry = this.normalizeText(industry);
    const normalizedKeyword = this.normalizeText(keyword);
    if (!normalizedIndustry || !normalizedKeyword) {
      return {
        industry: normalizedIndustry,
        platform: this.normalizePlatformValue(platform),
        keyword: normalizedKeyword,
        source: "skipped",
        scannedCount: 0,
        upsertedCount: 0,
        pendingCount: 0,
        contentIds: [],
      };
    }

    const response = await this.tikHubService.searchVideos(
      platform,
      normalizedKeyword,
      this.searchLimit,
    );
    const ingestResult = await this.ingestSearchResults({
      platform: response.platform,
      industry: normalizedIndustry,
      keywords: this.mergeKeywords(relatedKeywords, [
        normalizedIndustry,
        normalizedKeyword,
      ]),
      items: response.items,
    });

    return {
      ...ingestResult,
      keyword: normalizedKeyword,
      source: response.source,
    };
  }

  async ingestSearchResults(
    input: DiscoveryIngestInput,
  ): Promise<DiscoveryIngestResult> {
    const normalizedIndustry = this.normalizeText(input.industry);
    const normalizedPlatform = this.normalizePlatformValue(input.platform);
    const normalizedKeywords = this.mergeKeywords(
      input.keywords,
      normalizedIndustry ? [normalizedIndustry] : [],
    );
    const discoveredAt = input.discoveredAt || new Date();
    const contentIds: string[] = [];

    if (!normalizedIndustry || input.items.length === 0) {
      return {
        industry: normalizedIndustry,
        platform: normalizedPlatform,
        scannedCount: input.items.length,
        upsertedCount: 0,
        pendingCount: 0,
        contentIds,
      };
    }

    for (const item of input.items) {
      const contentKeywords = this.extractContentKeywords(
        item,
        normalizedKeywords,
      );
      const storedKeywords = this.mergeKeywords(
        contentKeywords,
        normalizedKeywords,
      );
      const viralScore = this.calculateViralScore(
        {
          views: item.metrics.views,
          likes: item.metrics.likes,
          comments: item.metrics.comments,
          shares: item.metrics.shares,
          keywords: contentKeywords,
        },
        item.publishedAt,
        normalizedKeywords,
      );
      const content = await this.viralContentModel
        .findOneAndUpdate(
          {
            platform: item.platform,
            videoId: item.videoId,
          },
          {
            $set: {
              platform: item.platform,
              videoId: item.videoId,
              title: item.title,
              author: item.author,
              viralScore,
              views: this.normalizeMetric(item.metrics.views),
              likes: this.normalizeMetric(item.metrics.likes),
              comments: this.normalizeMetric(item.metrics.comments),
              shares: this.normalizeMetric(item.metrics.shares),
              industry: normalizedIndustry,
              keywords: storedKeywords,
              publishedAt: this.parseDate(item.publishedAt),
              discoveredAt,
              contentUrl: item.contentUrl,
              thumbnailUrl: item.thumbnailUrl,
            },
            $setOnInsert: {
              remixStatus: this.getRejectedStatus(),
            },
          },
          {
            new: true,
            upsert: true,
          },
        )
        .lean()
        .exec();

      if (content?._id) {
        contentIds.push(content._id.toString());
      }
    }

    const p90Result = await this.refreshPendingCandidates(
      normalizedIndustry,
      normalizedPlatform,
    );

    return {
      industry: normalizedIndustry,
      platform: normalizedPlatform,
      scannedCount: input.items.length,
      upsertedCount: contentIds.length,
      pendingCount: p90Result.pendingCount,
      contentIds,
    };
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduledDiscoveryScan() {
    const startedAt = new Date();
    const plans = await this.buildScheduledScanPlans();
    const keywordResults: DiscoveryKeywordScanResult[] = [];
    const notifications: Record<string, any>[] = [];

    this.logger.log(`Discovery scan started with ${plans.length} plan(s).`);

    for (const plan of plans) {
      this.logger.debug(
        `Scanning platform=${plan.platform} industry=${plan.industry} keywords=${plan.keywords.join(", ") || "none"}`,
      );

      for (const keyword of plan.keywords) {
        const result = await this.scanKeyword(
          plan.platform,
          plan.industry,
          keyword,
          plan.keywords,
        );
        keywordResults.push(result);
      }

      const notification = await this.notifyPendingDiscoveriesForPlan(
        plan,
        startedAt,
      );
      if (notification) {
        notifications.push(notification);
      }
    }

    const totalContents = keywordResults.reduce(
      (sum, item) => sum + item.upsertedCount,
      0,
    );
    const totalPending = keywordResults.reduce(
      (sum, item) => sum + item.pendingCount,
      0,
    );
    const totalKeywords = keywordResults.length;

    this.logger.log(
      `Discovery scan finished. plans=${plans.length}, keywords=${totalKeywords}, upserts=${totalContents}, pending=${totalPending}, notifications=${notifications.length}`,
    );

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      plans: plans.length,
      keywords: totalKeywords,
      upserts: totalContents,
      pending: totalPending,
      notifications: notifications.length,
      notificationItems: notifications,
      items: keywordResults,
    };
  }

  private async buildScheduledScanPlans(): Promise<DiscoveryScanPlan[]> {
    const competitors = (await this.competitorModel
      .find({ isActive: true })
      .sort({ lastSyncedAt: -1, createdAt: -1 })
      .lean()
      .exec()) as unknown as LeanCompetitor[];

    if (competitors.length === 0) {
      return [];
    }

    const orgIds = Array.from(
      new Set(competitors.map((item) => item.orgId.toString())),
    );
    const [brands, organizations] = await Promise.all([
      this.brandModel
        .find({
          orgId: { $in: orgIds.map((id) => new Types.ObjectId(id)) },
          isActive: true,
        })
        .lean()
        .exec() as unknown as Promise<LeanBrand[]>,
      this.organizationModel
        .find({
          _id: { $in: orgIds.map((id) => new Types.ObjectId(id)) },
        })
        .lean()
        .exec() as unknown as Promise<LeanOrganization[]>,
    ]);

    const brandsByOrgId = new Map<string, LeanBrand[]>();
    for (const brand of brands) {
      const key = brand.orgId.toString();
      const items = brandsByOrgId.get(key) || [];
      items.push(brand);
      brandsByOrgId.set(key, items);
    }

    const organizationsById = new Map<string, LeanOrganization>(
      organizations.map((item) => [item._id.toString(), item]),
    );

    const planMap = new Map<string, DiscoveryScanPlan>();
    for (const competitor of competitors) {
      const orgId = competitor.orgId.toString();
      const platform = this.normalizePlatform(competitor.platform);
      if (!platform) {
        continue;
      }
      const orgBrands = brandsByOrgId.get(orgId) || [];
      const orgIndustry = this.extractOrgIndustry(organizationsById.get(orgId));

      if (orgBrands.length > 0) {
        for (const brand of orgBrands) {
          const industry = this.normalizeText(brand.industry) || orgIndustry;
          const keywords = this.mergeKeywords(
            brand.assets?.keywords || [],
            industry ? [industry] : [],
          );
          this.upsertScanPlan(planMap, {
            orgId,
            platform,
            industry,
            keywords,
            competitorCount: 1,
          });
        }
        continue;
      }

      if (!orgIndustry) {
        continue;
      }

      this.upsertScanPlan(planMap, {
        orgId,
        platform,
        industry: orgIndustry,
        keywords: [orgIndustry],
        competitorCount: 1,
      });
    }

    return Array.from(planMap.values()).filter(
      (plan) => plan.keywords.length > 0 && Boolean(plan.industry),
    );
  }

  private upsertScanPlan(
    planMap: Map<string, DiscoveryScanPlan>,
    input: DiscoveryScanPlan,
  ) {
    const normalizedIndustry = this.normalizeText(input.industry);
    const normalizedKeywords = this.mergeKeywords(
      input.keywords,
      normalizedIndustry ? [normalizedIndustry] : [],
    );
    if (!normalizedIndustry || normalizedKeywords.length === 0) {
      return;
    }

    const key = `${input.orgId}:${input.platform}:${normalizedIndustry}`;
    const current = planMap.get(key);
    if (!current) {
      planMap.set(key, {
        ...input,
        industry: normalizedIndustry,
        keywords: normalizedKeywords,
      });
      return;
    }

    current.keywords = this.mergeKeywords(current.keywords, normalizedKeywords);
    current.competitorCount += input.competitorCount;
  }

  private async refreshPendingCandidates(industry: string, platform?: string) {
    const query = this.buildDiscoveryQuery(industry, platform);
    if (!query["industry"]) {
      return {
        pendingCount: 0,
      };
    }

    const candidates = (await this.viralContentModel
      .find(query)
      .sort({ viralScore: -1, discoveredAt: -1 })
      .lean()
      .exec()) as unknown as LeanViralContent[];

    if (candidates.length === 0) {
      return {
        pendingCount: 0,
      };
    }

    const pendingCandidates = query["platform"]
      ? this.selectTopP90(candidates)
      : this.selectGroupedTopP90(candidates);
    const pendingIds = pendingCandidates.map((item) => item._id);
    const remixedStatus = ViralContentRemixStatus.REMIXED;

    await this.viralContentModel
      .updateMany(
        {
          ...query,
          remixStatus: { $ne: remixedStatus },
        },
        {
          $set: {
            remixStatus: this.getRejectedStatus(),
          },
        },
      )
      .exec();

    if (pendingIds.length > 0) {
      await this.viralContentModel
        .updateMany(
          {
            _id: { $in: pendingIds },
            remixStatus: { $ne: remixedStatus },
          },
          {
            $set: {
              remixStatus: ViralContentRemixStatus.PENDING,
            },
          },
        )
        .exec();
    }

    return {
      pendingCount: pendingIds.length,
    };
  }

  private selectTopP90<T extends { viralScore: number }>(candidates: T[]) {
    const count = Math.max(1, Math.ceil(candidates.length * 0.1));
    return candidates.slice(0, count);
  }

  private selectGroupedTopP90(candidates: LeanViralContent[]) {
    const groups = new Map<string, LeanViralContent[]>();
    for (const candidate of candidates) {
      const groupKey = `${candidate.platform}:${candidate.industry}`;
      const items = groups.get(groupKey) || [];
      items.push(candidate);
      groups.set(groupKey, items);
    }

    return this.sortViralContents(
      Array.from(groups.values()).flatMap((items) => this.selectTopP90(items)),
    );
  }

  private async getOrgTaskIds(orgId: string) {
    const match = this.buildOrgMatch(orgId);
    const tasks = await this.videoTaskModel
      .find(match, { _id: 1 })
      .lean()
      .exec();
    return tasks.map((task) => task._id.toString());
  }

  private buildOrgMatch(orgId: string) {
    const clauses: Record<string, any>[] = [{ userId: orgId }];
    if (Types.ObjectId.isValid(orgId)) {
      clauses.unshift({ orgId: new Types.ObjectId(orgId) });
    }

    return clauses.length === 1 ? clauses[0] : { $or: clauses };
  }

  private normalizePlatform(platform: string): TikHubPlatform | null {
    const normalizedPlatform = this.normalizePlatformValue(platform);
    const supportedPlatforms: TikHubPlatform[] = [
      "douyin",
      "xhs",
      "kuaishou",
      "bilibili",
    ];
    if (supportedPlatforms.includes(normalizedPlatform as TikHubPlatform)) {
      return normalizedPlatform as TikHubPlatform;
    }

    return null;
  }

  private extractOrgIndustry(org?: LeanOrganization) {
    const rawIndustry = org?.settings?.["industry"];
    if (typeof rawIndustry === "string") {
      return this.normalizeText(rawIndustry);
    }

    if (Array.isArray(rawIndustry)) {
      return this.normalizeText(
        rawIndustry.find((item) => typeof item === "string") || "",
      );
    }

    return "";
  }

  private mergeKeywords(primary: string[], secondary: string[]) {
    return Array.from(
      new Set(
        [...primary, ...secondary]
          .map((item) => this.normalizeText(item))
          .filter(Boolean),
      ),
    );
  }

  private normalizeText(value?: string | null) {
    return value?.trim() || "";
  }

  private normalizeKeyword(value?: string | null) {
    return value?.trim().toLowerCase() || "";
  }

  private normalizePlatformValue(platform?: string | null) {
    return platform?.trim().toLowerCase() || "";
  }

  private getRejectedStatus(): ViralContentRemixStatus {
    return ((ViralContentRemixStatus as Record<string, string>)["REJECTED"] ||
      "rejected") as ViralContentRemixStatus;
  }

  private normalizeMetric(value?: number) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Number(value));
  }

  private round(value: number) {
    return Number(value.toFixed(2));
  }

  private resolveHoursSincePublish(publishedAt?: string | Date | null) {
    const publishedDate = this.parseDate(publishedAt);
    if (!publishedDate) {
      return 24;
    }

    const diffInHours =
      (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60);
    if (!Number.isFinite(diffInHours)) {
      return 24;
    }

    return Math.max(0, diffInHours);
  }

  private calculateKeywordJaccard(
    videoKeywords: string[],
    industryKeywords: string[],
  ) {
    const videoSet = new Set(
      videoKeywords.map((item) => this.normalizeKeyword(item)).filter(Boolean),
    );
    const industrySet = new Set(
      industryKeywords
        .map((item) => this.normalizeKeyword(item))
        .filter(Boolean),
    );

    if (industrySet.size === 0) {
      return 1;
    }

    if (videoSet.size === 0) {
      return 0;
    }

    const union = new Set([...videoSet, ...industrySet]);
    let intersectionCount = 0;
    for (const keyword of videoSet) {
      if (industrySet.has(keyword)) {
        intersectionCount += 1;
      }
    }

    return intersectionCount / union.size;
  }

  private parseDate(value?: string | Date | null) {
    if (!value) {
      return null;
    }

    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private extractContentKeywords(
    item: Pick<SearchVideoSummary, "title" | "author">,
    candidateKeywords: string[],
  ) {
    const sourceText = [item.title, item.author].filter(Boolean).join(" ");
    const normalizedSource = this.normalizeKeyword(sourceText);
    const matchedKeywords = candidateKeywords.filter((keyword) => {
      const normalizedKeyword = this.normalizeKeyword(keyword);
      return normalizedKeyword
        ? normalizedSource.includes(normalizedKeyword)
        : false;
    });
    const fallbackKeywords =
      matchedKeywords.length > 0
        ? []
        : candidateKeywords.slice(0, Math.min(candidateKeywords.length, 2));
    const tokenKeywords = sourceText
      .split(/[^\p{L}\p{N}]+/u)
      .map((item) => this.normalizeKeyword(item))
      .filter((item) => item.length >= 2);

    return Array.from(
      new Set([...matchedKeywords, ...fallbackKeywords, ...tokenKeywords]),
    );
  }

  private buildDiscoveryQuery(industry: string, platform?: string) {
    const query: Record<string, any> = {};
    const normalizedIndustry = this.normalizeText(industry);
    const normalizedPlatform = this.normalizePlatformValue(platform);

    if (normalizedIndustry) {
      query["industry"] = normalizedIndustry;
    }

    if (normalizedPlatform) {
      query["platform"] = normalizedPlatform;
    }

    return query;
  }

  private sortViralContents<
    T extends { viralScore: number; discoveredAt?: Date | string | null },
  >(items: T[]) {
    return [...items].sort((left, right) => {
      if (right.viralScore !== left.viralScore) {
        return right.viralScore - left.viralScore;
      }

      return this.toTime(right.discoveredAt) - this.toTime(left.discoveredAt);
    });
  }

  private toTime(value?: Date | string | null) {
    if (!value) {
      return 0;
    }

    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  private async resolveTaskBrandId(taskId: Types.ObjectId | null) {
    if (!taskId) {
      return null;
    }

    const task = (await this.videoTaskModel
      .findById(taskId, { brandId: 1 })
      .lean()
      .exec()) as unknown as {
      brandId?: Identifier | null;
    } | null;

    if (!task?.brandId) {
      return null;
    }

    return new Types.ObjectId(task.brandId.toString());
  }

  private async notifyPendingDiscoveriesForPlan(
    plan: DiscoveryScanPlan,
    startedAt: Date,
  ) {
    const items = (await this.viralContentModel
      .find({
        platform: plan.platform,
        industry: this.normalizeText(plan.industry),
        remixStatus: ViralContentRemixStatus.PENDING,
        createdAt: { $gte: startedAt },
      })
      .sort({ viralScore: -1, discoveredAt: -1 })
      .lean()
      .exec()) as unknown as LeanViralContent[];

    if (items.length < 3) {
      return null;
    }

    return this.discoveryNotificationService.notifyNewDiscoveries(
      plan.orgId,
      items,
    );
  }
}
