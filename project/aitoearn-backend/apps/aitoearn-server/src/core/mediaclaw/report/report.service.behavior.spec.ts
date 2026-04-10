import { Workbook } from 'exceljs'
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

  it('应生成 csv、json 和 excel 产物', async () => {
    vi.spyOn(service as any, 'buildMetrics').mockResolvedValue({
      totalVideos: 7,
      completedVideos: 6,
      failedVideos: 1,
      successRate: 85.71,
      avgCost: 12.3,
      totalCampaigns: 2,
      activeCampaigns: 1,
      performance: {
        totalViews: 4567,
        totalLikes: 321,
        totalComments: 45,
        totalShares: 12,
        totalSaves: 8,
        totalFollowers: 99,
        avgEngagementRate: 5.4,
      },
      topBrands: [{ brandName: '品牌 B', totalVideos: 4, completedVideos: 3 }],
      topContent: [{ taskId: 'task_2', views: 2300, engagementRate: 6.2, publishedAt: '2026-04-06T00:00:00.000Z', outputVideoUrl: 'https://cdn.example.com/task-2.mp4' }],
      recommendations: ['继续放大高互动脚本模版。'],
    })

    const result = await service.generateReport(
      new Types.ObjectId().toString(),
      'weekly' as any,
      {
        start: '2026-04-01T00:00:00.000Z',
        end: '2026-04-08T00:00:00.000Z',
      },
      {
        formats: ['csv', 'json', 'excel'],
        waitForCompletion: true,
      },
    )

    expect(result.requestedFormats).toEqual(['csv', 'json', 'excel'])
    expect(result.assets.csv?.url).toContain('/files/csv')
    expect(result.assets.json?.url).toContain('/files/json')
    expect(result.assets.excel?.url).toContain('/files/excel')

    const csvFile = await service.getReportFile(result.orgId, result.id, 'csv')
    expect(csvFile.contentType).toBe('text/csv; charset=utf-8')
    expect(csvFile.encoding).toBe('utf8')
    expect(csvFile.content).toContain('section,label,value')
    expect(csvFile.content).toContain('summary,total_videos,7')

    const jsonFile = await service.getReportFile(result.orgId, result.id, 'json')
    expect(jsonFile.contentType).toBe('application/json; charset=utf-8')
    const parsedJson = JSON.parse(jsonFile.content || '{}')
    expect(parsedJson.metrics.totalVideos).toBe(7)
    expect(parsedJson.metrics.performance.totalViews).toBe(4567)

    const excelFile = await service.getReportFile(result.orgId, result.id, 'excel')
    expect(excelFile.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(excelFile.encoding).toBe('base64')
    const workbook = new Workbook()
    await workbook.xlsx.load(Buffer.from(excelFile.content || '', 'base64'))
    expect(workbook.worksheets.map(item => item.name)).toEqual(['Summary', 'TopBrands', 'TopContent', 'Recommendations'])
    expect(workbook.getWorksheet('Summary')?.getCell('A1').value).toBe('Section')
    expect(workbook.getWorksheet('TopBrands')?.getCell('A2').value).toBe('品牌 B')
  })
})
