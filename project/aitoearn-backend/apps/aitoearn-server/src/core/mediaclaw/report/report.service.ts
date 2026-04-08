import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Brand,
  Campaign,
  CampaignStatus,
  Organization,
  Report,
  ReportStatus,
  ReportType,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, PipelineStage, Types } from 'mongoose'
import { MEDIACLAW_SUCCESS_STATUSES } from '../video-task-status.utils'

interface ReportPeriodInput {
  start: string
  end: string
}

interface ReportFilters {
  type?: ReportType
  startDate?: string
  endDate?: string
}

type ReportAssetFormat = 'pdf' | 'markdown'

interface GenerateReportOptions {
  formats?: string[]
  waitForCompletion?: boolean
}

interface ReportAssetDescriptor {
  url: string
  contentType: string
  encoding: 'base64' | 'utf8'
  size: number
}

interface ReportAssetBundle {
  generatedAt: string
  files: Partial<Record<ReportAssetFormat, ReportAssetDescriptor>>
  content: Partial<Record<ReportAssetFormat, string>>
}

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name)

  constructor(
    @InjectModel(Report.name)
    private readonly reportModel: Model<Report>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<Campaign>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
  ) {}

  async generateReport(
    orgId: string,
    type: ReportType,
    period: ReportPeriodInput,
    options: GenerateReportOptions = {},
  ) {
    const normalizedOrgId = new Types.ObjectId(orgId)
    const normalizedPeriod = this.normalizePeriod(period)
    const requestedFormats = this.normalizeFormats(options.formats)
    const reportId = new Types.ObjectId()
    const queuedMetrics = {
      requestedFormats,
      job: {
        queuedAt: new Date().toISOString(),
        executionMode: options.waitForCompletion ? 'sync' : 'async',
      },
      generatedAssets: {
        files: this.buildAssetDescriptors(reportId.toString(), requestedFormats),
        content: {},
      },
    }

    const report = await this.reportModel.create({
      _id: reportId,
      orgId: normalizedOrgId,
      type,
      period: normalizedPeriod,
      metrics: queuedMetrics,
      fileUrl: this.buildPrimaryFileUrl(reportId.toString(), requestedFormats),
      status: ReportStatus.GENERATING,
      generatedAt: null,
    })

    if (options.waitForCompletion) {
      return this.completeReportById(
        reportId.toString(),
        normalizedOrgId,
        type,
        normalizedPeriod,
        requestedFormats,
      )
    }

    void this.completeReportById(
      reportId.toString(),
      normalizedOrgId,
      type,
      normalizedPeriod,
      requestedFormats,
    ).catch(() => undefined)

    return this.toResponse(typeof report.toObject === 'function' ? report.toObject() : report)
  }

  async listReports(orgId: string, filters: ReportFilters = {}) {
    const query: Record<string, any> = {
      orgId: new Types.ObjectId(orgId),
    }

    if (filters.type) {
      query['type'] = filters.type
    }

    if (filters.startDate || filters.endDate) {
      query['generatedAt'] = {}

      if (filters.startDate) {
        query['generatedAt']['$gte'] = new Date(filters.startDate)
      }

      if (filters.endDate) {
        query['generatedAt']['$lte'] = new Date(filters.endDate)
      }
    }

    const reports = await this.reportModel.find(query)
      .sort({ generatedAt: -1, createdAt: -1 })
      .lean()
      .exec()

    return reports.map(report => this.toResponse(report))
  }

  async getReport(orgId: string, id: string) {
    const report = await this.reportModel.findOne(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!report) {
      throw new NotFoundException('Report not found')
    }

    return this.toResponse(report)
  }

  async getReportFile(orgId: string, id: string, format: string) {
    const normalizedFormat = this.normalizeSingleFormat(format)
    const report = await this.reportModel.findOne(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!report) {
      throw new NotFoundException('Report not found')
    }

    const rawMetrics = this.asRecord(report.metrics)
    const requestedFormats = this.extractRequestedFormats(rawMetrics)
    const generatedAssets = this.asRecord(rawMetrics['generatedAssets'])
    const files = this.extractAssetFiles(report._id.toString(), requestedFormats, generatedAssets)
    const descriptor = files[normalizedFormat]

    if (!descriptor) {
      throw new NotFoundException('Report file not found')
    }

    const content = this.asRecord(generatedAssets['content'])[normalizedFormat]

    return {
      reportId: report._id.toString(),
      type: report.type,
      status: report.status,
      format: normalizedFormat,
      ...descriptor,
      content: typeof content === 'string' ? content : null,
    }
  }

  async scheduleAutoReport(orgId: string, config: Record<string, any>) {
    const organization = await this.organizationModel.findByIdAndUpdate(
      new Types.ObjectId(orgId),
      {
        $set: {
          'settings.autoReport': {
            ...(config || {}),
            isActive: config?.['isActive'] ?? true,
            updatedAt: new Date().toISOString(),
          },
        },
      },
      { new: true },
    ).lean().exec()

    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    return {
      orgId,
      scheduled: true,
      config: organization.settings?.['autoReport'] || {},
    }
  }

  async deleteReport(orgId: string, id: string) {
    const deleted = await this.reportModel.findOneAndDelete(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!deleted) {
      throw new NotFoundException('Report not found')
    }

    return {
      id,
      deleted: true,
    }
  }

  private async completeReportById(
    reportId: string,
    orgId: Types.ObjectId,
    type: ReportType,
    period: { start: Date, end: Date },
    formats: ReportAssetFormat[],
  ) {
    try {
      const metrics = await this.buildMetrics(orgId, type, period)
      const generatedAssets = this.renderReportAssets(reportId, type, period, metrics, formats)
      const updated = await this.reportModel.findByIdAndUpdate(
        new Types.ObjectId(reportId),
        {
          metrics: {
            ...metrics,
            requestedFormats: formats,
            generatedAssets,
          },
          fileUrl: this.buildPrimaryFileUrl(reportId, formats),
          status: ReportStatus.READY,
          generatedAt: new Date(),
        },
        { new: true },
      ).lean().exec()

      return this.toResponse(updated)
    }
    catch (error) {
      await this.reportModel.findByIdAndUpdate(new Types.ObjectId(reportId), {
        status: ReportStatus.FAILED,
        generatedAt: new Date(),
        metrics: {
          requestedFormats: formats,
          error: error instanceof Error ? error.message : String(error),
        },
      }).exec()

      this.logger.error(JSON.stringify({
        message: 'Failed to generate report',
        reportId,
        orgId: orgId.toString(),
        type,
        error: error instanceof Error ? error.message : String(error),
      }))

      throw new InternalServerErrorException('Failed to generate report')
    }
  }

  private async buildMetrics(
    orgId: Types.ObjectId,
    type: ReportType,
    period: { start: Date, end: Date },
  ) {
    const baseQuery = {
      orgId,
      createdAt: {
        $gte: period.start,
        $lte: period.end,
      },
    }

    const [taskStats, topBrandRows, totalCampaigns, activeCampaigns, performanceRows, topContentRows] = await Promise.all([
      this.videoTaskModel.aggregate<{
        totalVideos: number
        completedVideos: number
        failedVideos: number
        avgCreditsConsumed: number
      }>([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            totalVideos: { $sum: 1 },
            completedVideos: {
              $sum: {
                $cond: [{ $in: ['$status', MEDIACLAW_SUCCESS_STATUSES] }, 1, 0],
              },
            },
            failedVideos: {
              $sum: {
                $cond: [{ $eq: ['$status', VideoTaskStatus.FAILED] }, 1, 0],
              },
            },
            avgCreditsConsumed: { $avg: '$creditsConsumed' },
          },
        },
      ]),
      this.videoTaskModel.aggregate<{
        _id: Types.ObjectId
        totalVideos: number
        completedVideos: number
      }>([
        {
          $match: {
            ...baseQuery,
            brandId: { $ne: null },
          },
        },
        {
          $group: {
            _id: '$brandId',
            totalVideos: { $sum: 1 },
            completedVideos: {
              $sum: {
                $cond: [{ $in: ['$status', MEDIACLAW_SUCCESS_STATUSES] }, 1, 0],
              },
            },
          },
        },
        { $sort: { totalVideos: -1 } },
        { $limit: 5 },
      ]),
      this.campaignModel.countDocuments(baseQuery),
      this.campaignModel.countDocuments({
        ...baseQuery,
        status: CampaignStatus.ACTIVE,
      }),
      this.videoTaskModel.aggregate<{
        totalViews: number
        totalLikes: number
        totalComments: number
        totalShares: number
        totalSaves: number
        totalFollowers: number
        avgEngagementRate: number
      }>([
        { $match: baseQuery },
        ...this.buildLatestAnalyticsLookupStages(period.start),
        {
          $group: {
            _id: null,
            totalViews: { $sum: '$views' },
            totalLikes: { $sum: '$likes' },
            totalComments: { $sum: '$comments' },
            totalShares: { $sum: '$shares' },
            totalSaves: { $sum: '$saves' },
            totalFollowers: { $sum: '$followers' },
            avgEngagementRate: { $avg: '$engagementRate' },
          },
        },
        {
          $project: {
            _id: 0,
            totalViews: 1,
            totalLikes: 1,
            totalComments: 1,
            totalShares: 1,
            totalSaves: 1,
            totalFollowers: 1,
            avgEngagementRate: { $round: ['$avgEngagementRate', 2] },
          },
        },
      ]),
      this.videoTaskModel.aggregate<{
        taskId: string
        outputVideoUrl: string
        views: number
        engagementRate: number
        publishedAt: Date | null
      }>([
        { $match: baseQuery },
        ...this.buildLatestAnalyticsLookupStages(period.start),
        {
          $project: {
            _id: 0,
            taskId: { $toString: '$_id' },
            outputVideoUrl: 1,
            views: 1,
            engagementRate: 1,
            publishedAt: '$publishedAt',
          },
        },
        { $sort: { views: -1, engagementRate: -1, publishedAt: -1 } },
        { $limit: 5 },
      ]),
    ])

    const topBrandIds = topBrandRows.map(row => row._id).filter(Boolean)
    const brandRecords = topBrandIds.length > 0
      ? await this.brandModel.find({ _id: { $in: topBrandIds } }).select({ _id: 1, name: 1 }).lean().exec()
      : []
    const brandNameMap = new Map(brandRecords.map(brand => [brand._id.toString(), brand.name]))
    const summary = taskStats[0] || {
      totalVideos: 0,
      completedVideos: 0,
      failedVideos: 0,
      avgCreditsConsumed: 0,
    }
    const performance = performanceRows[0] || {
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalSaves: 0,
      totalFollowers: 0,
      avgEngagementRate: 0,
    }

    return {
      reportType: type,
      totalVideos: summary.totalVideos,
      completedVideos: summary.completedVideos,
      failedVideos: summary.failedVideos,
      successRate: this.toRate(summary.completedVideos, summary.totalVideos),
      avgCost: Number((summary.avgCreditsConsumed || 0).toFixed(2)),
      totalCampaigns,
      activeCampaigns,
      performance,
      topBrands: topBrandRows.map(row => ({
        brandId: row._id.toString(),
        brandName: brandNameMap.get(row._id.toString()) || 'Unknown Brand',
        totalVideos: row.totalVideos,
        completedVideos: row.completedVideos,
      })),
      topContent: topContentRows.map(item => ({
        taskId: item.taskId,
        outputVideoUrl: item.outputVideoUrl || '',
        views: item.views || 0,
        engagementRate: item.engagementRate || 0,
        publishedAt: item.publishedAt || null,
      })),
      recommendations: this.buildRecommendations(summary, performance, topContentRows),
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
    }
  }

  private normalizePeriod(period: ReportPeriodInput) {
    const start = new Date(period.start)
    const end = new Date(period.end)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      throw new InternalServerErrorException('Invalid report period')
    }

    return { start, end }
  }

  private buildRecommendations(
    summary: {
      totalVideos: number
      completedVideos: number
    },
    performance: {
      totalViews: number
      avgEngagementRate: number
    },
    topContent: Array<{ views?: number }>,
  ) {
    const successRate = this.toRate(summary.completedVideos, summary.totalVideos)

    return [
      successRate < 70
        ? '优先排查失败链路并收缩到高完成率模板。'
        : '保持当前高完成率模板占比，继续放大稳定产能。',
      performance.avgEngagementRate < 3
        ? '优先优化前 3 秒钩子和评论引导，提升互动率。'
        : '互动率已达稳定区间，可重点扩大发布量。',
      (topContent[0]?.views || 0) > 0
        ? '复用当前 TOP 内容的蓝词和发布时间窗口，进入下一轮生产。'
        : '当前仍处于冷启动期，继续累积样本后再切换到自有数据驱动。',
    ]
  }

  private buildLatestAnalyticsLookupStages(startDate: Date): PipelineStage[] {
    return [
      {
        $lookup: {
          from: 'video_analytics',
          let: { taskId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$videoTaskId', '$$taskId'] },
                recordedAt: { $gte: startDate },
              },
            },
            { $sort: { recordedAt: -1 } },
            { $limit: 1 },
          ],
          as: 'latestAnalytics',
        },
      },
      {
        $addFields: {
          latestAnalytics: { $arrayElemAt: ['$latestAnalytics', 0] },
          views: this.buildMetricExpression([
            'latestAnalytics.views',
            'latestAnalytics.metrics.views',
            'analyticsSnapshot.views',
            'metadata.analyticsSnapshot.views',
            'metadata.analytics.views',
            'metadata.views',
          ]),
          likes: this.buildMetricExpression([
            'latestAnalytics.likes',
            'latestAnalytics.metrics.likes',
            'metadata.analyticsSnapshot.likes',
            'metadata.analytics.likes',
            'metadata.likes',
          ]),
          comments: this.buildMetricExpression([
            'latestAnalytics.comments',
            'latestAnalytics.metrics.comments',
            'metadata.analyticsSnapshot.comments',
            'metadata.analytics.comments',
            'metadata.comments',
          ]),
          shares: this.buildMetricExpression([
            'latestAnalytics.shares',
            'latestAnalytics.metrics.shares',
            'metadata.analyticsSnapshot.shares',
            'metadata.analytics.shares',
            'metadata.shares',
          ]),
          saves: this.buildMetricExpression([
            'latestAnalytics.saves',
            'latestAnalytics.metrics.saves',
            'metadata.analyticsSnapshot.saves',
            'metadata.analytics.saves',
            'metadata.saves',
          ]),
          followers: this.buildMetricExpression([
            'latestAnalytics.followers',
            'latestAnalytics.metrics.followers',
            'metadata.analyticsSnapshot.followers',
            'metadata.analytics.followers',
            'metadata.followers',
          ]),
        },
      },
      {
        $addFields: {
          engagementRate: {
            $cond: [
              { $gt: ['$views', 0] },
              {
                $cond: [
                  { $gt: ['$latestAnalytics.engagementRate', 0] },
                  '$latestAnalytics.engagementRate',
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $add: ['$likes', '$comments', '$shares', '$saves'] },
                          '$views',
                        ],
                      },
                      100,
                    ],
                  },
                ],
              },
              0,
            ],
          },
        },
      },
    ]
  }

  private buildMetricExpression(paths: string[]) {
    return paths.reduceRight<Record<string, unknown> | number>(
      (fallback, path) => ({
        $ifNull: [
          {
            $convert: {
              input: `$${path}`,
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          fallback,
        ],
      }),
      0,
    )
  }

  private renderReportAssets(
    reportId: string,
    type: ReportType,
    period: { start: Date, end: Date },
    metrics: Record<string, any>,
    formats: ReportAssetFormat[],
  ): ReportAssetBundle {
    const generatedAt = new Date().toISOString()
    const files = this.buildAssetDescriptors(reportId, formats)
    const content: Partial<Record<ReportAssetFormat, string>> = {}

    if (formats.includes('markdown')) {
      const markdown = this.renderMarkdown(type, period, metrics)
      content.markdown = markdown
      files.markdown = {
        ...files.markdown!,
        encoding: 'utf8',
        size: Buffer.byteLength(markdown, 'utf8'),
      }
    }

    if (formats.includes('pdf')) {
      const pdfBase64 = this.renderPdfDocument(this.renderPdfLines(type, period, metrics))
      content.pdf = pdfBase64
      files.pdf = {
        ...files.pdf!,
        encoding: 'base64',
        size: Buffer.from(pdfBase64, 'base64').length,
      }
    }

    return {
      generatedAt,
      files,
      content,
    }
  }

  private renderMarkdown(
    type: ReportType,
    period: { start: Date, end: Date },
    metrics: Record<string, any>,
  ) {
    const topBrands = Array.isArray(metrics['topBrands']) ? metrics['topBrands'] : []
    const topContent = Array.isArray(metrics['topContent']) ? metrics['topContent'] : []
    const performance = this.asRecord(metrics['performance'])
    const recommendations = Array.isArray(metrics['recommendations']) ? metrics['recommendations'] : []

    return [
      `# MediaClaw ${type} Report`,
      '',
      `- Period: ${period.start.toISOString()} ~ ${period.end.toISOString()}`,
      `- Total Videos: ${metrics['totalVideos'] || 0}`,
      `- Success Rate: ${metrics['successRate'] || 0}%`,
      `- Total Views: ${performance['totalViews'] || 0}`,
      `- Avg Engagement Rate: ${performance['avgEngagementRate'] || 0}%`,
      '',
      '## Top Brands',
      ...(topBrands.length > 0
        ? topBrands.map((item: Record<string, any>) => `- ${item['brandName']}: ${item['totalVideos']} videos`)
        : ['- No brand data']),
      '',
      '## Top Content',
      ...(topContent.length > 0
        ? topContent.map((item: Record<string, any>) => `- ${item['taskId']}: ${item['views']} views / ${item['engagementRate']}% ER`)
        : ['- No content data']),
      '',
      '## Recommendations',
      ...(recommendations.length > 0
        ? recommendations.map((item: string) => `- ${item}`)
        : ['- Continue collecting analytics signals']),
      '',
    ].join('\n')
  }

  private renderPdfLines(
    type: ReportType,
    period: { start: Date, end: Date },
    metrics: Record<string, any>,
  ) {
    const performance = this.asRecord(metrics['performance'])
    const recommendations = Array.isArray(metrics['recommendations']) ? metrics['recommendations'] : []

    return [
      `MediaClaw ${type} Report`,
      `Period: ${period.start.toISOString()} -> ${period.end.toISOString()}`,
      `Total Videos: ${metrics['totalVideos'] || 0}`,
      `Success Rate: ${metrics['successRate'] || 0}%`,
      `Total Views: ${performance['totalViews'] || 0}`,
      `Avg ER: ${performance['avgEngagementRate'] || 0}%`,
      ...recommendations.map((item: string, index: number) => `Action ${index + 1}: ${item}`),
    ]
  }

  private renderPdfDocument(lines: string[]) {
    const escapedLines = lines.map(line => this.escapePdfText(line))
    const contentStream = [
      'BT',
      '/F1 12 Tf',
      '50 780 Td',
      '16 TL',
      ...escapedLines.flatMap((line, index) => (index === 0 ? [`(${line}) Tj`] : ['T*', `(${line}) Tj`])),
      'ET',
    ].join('\n')

    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
      '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      `5 0 obj << /Length ${Buffer.byteLength(contentStream, 'utf8')} >> stream\n${contentStream}\nendstream endobj`,
    ]

    let pdf = '%PDF-1.4\n'
    const offsets: number[] = [0]

    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'))
      pdf += `${object}\n`
    }

    const xrefOffset = Buffer.byteLength(pdf, 'utf8')
    pdf += `xref\n0 ${objects.length + 1}\n`
    pdf += '0000000000 65535 f \n'
    offsets.slice(1).forEach((offset) => {
      pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`
    })
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

    return Buffer.from(pdf, 'utf8').toString('base64')
  }

  private escapePdfText(value: string) {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
  }

  private buildPrimaryFileUrl(reportId: string, formats: ReportAssetFormat[]) {
    const primary = formats[0] || 'pdf'
    return this.buildFileUrl(reportId, primary)
  }

  private buildAssetDescriptors(
    reportId: string,
    formats: ReportAssetFormat[],
  ): Partial<Record<ReportAssetFormat, ReportAssetDescriptor>> {
    const files: Partial<Record<ReportAssetFormat, ReportAssetDescriptor>> = {}

    if (formats.includes('pdf')) {
      files.pdf = {
        url: this.buildFileUrl(reportId, 'pdf'),
        contentType: 'application/pdf',
        encoding: 'base64',
        size: 0,
      }
    }

    if (formats.includes('markdown')) {
      files.markdown = {
        url: this.buildFileUrl(reportId, 'markdown'),
        contentType: 'text/markdown; charset=utf-8',
        encoding: 'utf8',
        size: 0,
      }
    }

    return files
  }

  private buildFileUrl(reportId: string, format: ReportAssetFormat) {
    return `/api/v1/reports/${reportId}/files/${format}`
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
    }
  }

  private normalizeFormats(input?: string[]) {
    const requested = Array.isArray(input) && input.length > 0
      ? input
      : ['pdf', 'markdown']

    const normalized = [...new Set(
      requested
        .map(item => item.trim().toLowerCase())
        .filter(item => item === 'pdf' || item === 'markdown'),
    )] as ReportAssetFormat[]

    if (normalized.length === 0) {
      throw new BadRequestException('formats must include pdf or markdown')
    }

    return normalized
  }

  private normalizeSingleFormat(format: string): ReportAssetFormat {
    const normalized = format.trim().toLowerCase()
    if (normalized === 'pdf' || normalized === 'markdown') {
      return normalized
    }

    throw new BadRequestException('format must be pdf or markdown')
  }

  private extractRequestedFormats(metrics: Record<string, any>) {
    const rawFormats = Array.isArray(metrics['requestedFormats'])
      ? metrics['requestedFormats']
      : undefined

    try {
      return this.normalizeFormats(rawFormats)
    }
    catch {
      return ['pdf', 'markdown'] as ReportAssetFormat[]
    }
  }

  private extractAssetFiles(
    reportId: string,
    formats: ReportAssetFormat[],
    generatedAssets: Record<string, any>,
  ) {
    const files = this.asRecord(generatedAssets['files'])
    return {
      ...this.buildAssetDescriptors(reportId, formats),
      ...files,
    }
  }

  private asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object'
      ? value as Record<string, any>
      : {}
  }

  private toRate(value: number, total: number) {
    if (!total) {
      return 0
    }

    return Number(((value / total) * 100).toFixed(2))
  }

  private toResponse(report: {
    _id: { toString: () => string }
    orgId: { toString: () => string }
    type: ReportType
    period: { start: Date, end: Date }
    metrics: Record<string, any>
    fileUrl: string
    status: ReportStatus
    generatedAt: Date | null
    createdAt?: Date
    updatedAt?: Date
  } | null) {
    if (!report) {
      throw new NotFoundException('Report not found')
    }

    const rawMetrics = this.asRecord(report.metrics)
    const requestedFormats = this.extractRequestedFormats(rawMetrics)
    const generatedAssets = this.asRecord(rawMetrics['generatedAssets'])
    const assets = this.extractAssetFiles(report._id.toString(), requestedFormats, generatedAssets)
    const metrics = { ...rawMetrics }
    delete metrics['requestedFormats']
    delete metrics['generatedAssets']

    return {
      id: report._id.toString(),
      orgId: report.orgId.toString(),
      type: report.type,
      period: report.period,
      metrics,
      requestedFormats,
      assets,
      fileUrl: report.fileUrl,
      status: report.status,
      generatedAt: report.generatedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    }
  }
}
