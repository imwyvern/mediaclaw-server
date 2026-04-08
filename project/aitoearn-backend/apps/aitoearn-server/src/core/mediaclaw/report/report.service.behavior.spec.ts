import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportService } from './report.service'

vi.mock('@yikart/mongodb', () => {
  class Brand {}
  class Campaign {}
  class Organization {}
  class Report {}
  class VideoTask {}

  return {
    Brand,
    Campaign,
    Organization,
    Report,
    VideoTask,
    CampaignStatus: {
      ACTIVE: 'active',
    },
    ReportStatus: {
      GENERATING: 'generating',
      READY: 'ready',
      FAILED: 'failed',
    },
    ReportType: {
      WEEKLY: 'weekly',
      MONTHLY: 'monthly',
      CAMPAIGN: 'campaign',
      BRAND: 'brand',
    },
    VideoTaskStatus: {
      FAILED: 'failed',
    },
  }
})

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)

  return query
}

describe('reportService behavior', () => {
  let storedReport: Record<string, any> | null
  let reportModel: Record<string, any>
  let videoTaskModel: Record<string, any>
  let brandModel: Record<string, any>
  let campaignModel: Record<string, any>
  let organizationModel: Record<string, any>
  let service: ReportService

  beforeEach(() => {
    storedReport = null

    reportModel = {
      create: vi.fn().mockImplementation(async (payload: Record<string, any>) => {
        storedReport = {
          ...payload,
          createdAt: new Date('2026-04-08T12:00:00.000Z'),
          updatedAt: new Date('2026-04-08T12:00:00.000Z'),
          toObject() {
            return storedReport
          },
        }

        return storedReport
      }),
      findByIdAndUpdate: vi.fn().mockImplementation((_id: Types.ObjectId, update: Record<string, any>) => {
        storedReport = {
          ...(storedReport || {}),
          ...update,
          metrics: update.metrics || storedReport?.['metrics'],
          updatedAt: new Date('2026-04-08T12:10:00.000Z'),
        }

        return createQuery(storedReport)
      }),
      findOne: vi.fn().mockImplementation(() => createQuery(storedReport)),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOneAndDelete: vi.fn().mockReturnValue(createQuery(storedReport)),
    }

    videoTaskModel = {
      aggregate: vi.fn().mockReturnValue(createQuery([])),
    }
    brandModel = {
      find: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      }),
    }
    campaignModel = {
      countDocuments: vi.fn().mockResolvedValue(0),
    }
    organizationModel = {
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery({
        settings: { autoReport: { isActive: true } },
      })),
    }

    service = new ReportService(
      reportModel as any,
      videoTaskModel as any,
      brandModel as any,
      campaignModel as any,
      organizationModel as any,
    )
  })

  it('应同步生成 markdown 和 pdf 产物', async () => {
    vi.spyOn(service as any, 'buildMetrics').mockResolvedValue({
      totalVideos: 5,
      completedVideos: 4,
      successRate: 80,
      performance: {
        totalViews: 3200,
        avgEngagementRate: 4.6,
      },
      topBrands: [{ brandName: '品牌 A', totalVideos: 3 }],
      topContent: [{ taskId: 'task_1', views: 1200, engagementRate: 4.8 }],
      recommendations: ['优先复用当前 TOP 内容的发布时间窗口。'],
    })

    const result = await service.generateReport(
      new Types.ObjectId().toString(),
      'weekly' as any,
      {
        start: '2026-04-01T00:00:00.000Z',
        end: '2026-04-08T00:00:00.000Z',
      },
      {
        formats: ['pdf', 'markdown'],
        waitForCompletion: true,
      },
    )

    expect(result.status).toBe('ready')
    expect(result.requestedFormats).toEqual(['pdf', 'markdown'])
    expect(result.assets.pdf?.url).toContain('/files/pdf')
    expect(result.assets.markdown?.url).toContain('/files/markdown')

    const markdownFile = await service.getReportFile(result.orgId, result.id, 'markdown')
    expect(markdownFile.content).toContain('# MediaClaw weekly Report')

    const pdfFile = await service.getReportFile(result.orgId, result.id, 'pdf')
    expect(typeof pdfFile.content).toBe('string')
    expect(pdfFile.content?.length).toBeGreaterThan(20)
  })

  it('应默认异步返回 generating 状态并触发后台生成', async () => {
    const completeSpy = vi.spyOn(service as any, 'completeReportById').mockResolvedValue({
      id: 'report_1',
      status: 'ready',
    })

    const result = await service.generateReport(
      new Types.ObjectId().toString(),
      'weekly' as any,
      {
        start: '2026-04-01T00:00:00.000Z',
        end: '2026-04-08T00:00:00.000Z',
      },
    )

    expect(result.status).toBe('generating')
    expect(completeSpy).toHaveBeenCalledTimes(1)
  })
})
