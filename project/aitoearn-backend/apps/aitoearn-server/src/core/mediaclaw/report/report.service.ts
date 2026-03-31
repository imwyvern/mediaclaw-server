import {
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
import { Model, Types } from 'mongoose'
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

  async generateReport(orgId: string, type: ReportType, period: ReportPeriodInput) {
    const normalizedOrgId = new Types.ObjectId(orgId)
    const normalizedPeriod = this.normalizePeriod(period)

    const report = await this.reportModel.create({
      orgId: normalizedOrgId,
      type,
      period: normalizedPeriod,
      metrics: {},
      fileUrl: '',
      status: ReportStatus.GENERATING,
      generatedAt: null,
    })

    try {
      const metrics = await this.buildMetrics(normalizedOrgId, type, normalizedPeriod)
      const updated = await this.reportModel.findByIdAndUpdate(
        report._id,
        {
          metrics,
          fileUrl: this.buildFileUrl(report._id.toString(), type),
          status: ReportStatus.READY,
          generatedAt: new Date(),
        },
        { new: true },
      ).lean().exec()

      return this.toResponse(updated)
    }
    catch (error) {
      await this.reportModel.findByIdAndUpdate(report._id, {
        status: ReportStatus.FAILED,
        generatedAt: new Date(),
        metrics: {
          error: error instanceof Error ? error.message : String(error),
        },
      }).exec()

      this.logger.error(JSON.stringify({
        message: 'Failed to generate report',
        orgId,
        type,
        error: error instanceof Error ? error.message : String(error),
      }))

      throw new InternalServerErrorException('Failed to generate report')
    }
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

    const [taskStats, topBrandRows, totalCampaigns, activeCampaigns] = await Promise.all([
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

    return {
      reportType: type,
      totalVideos: summary.totalVideos,
      completedVideos: summary.completedVideos,
      failedVideos: summary.failedVideos,
      successRate: this.toRate(summary.completedVideos, summary.totalVideos),
      avgCost: Number((summary.avgCreditsConsumed || 0).toFixed(2)),
      totalCampaigns,
      activeCampaigns,
      topBrands: topBrandRows.map(row => ({
        brandId: row._id.toString(),
        brandName: brandNameMap.get(row._id.toString()) || 'Unknown Brand',
        totalVideos: row.totalVideos,
        completedVideos: row.completedVideos,
      })),
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

  private buildFileUrl(reportId: string, type: ReportType) {
    return `/api/v1/reports/${reportId}/files/${type}.pdf`
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
    }
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

    return {
      id: report._id.toString(),
      orgId: report.orgId.toString(),
      type: report.type,
      period: report.period,
      metrics: report.metrics || {},
      fileUrl: report.fileUrl,
      status: report.status,
      generatedAt: report.generatedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    }
  }
}
