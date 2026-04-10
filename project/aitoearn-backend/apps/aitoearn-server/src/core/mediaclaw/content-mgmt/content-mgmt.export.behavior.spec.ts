import AdmZip from 'adm-zip'
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentMgmtService } from './content-mgmt.service'

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
  }

  query.lean.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)

  return query
}

function createTask(overrides: Record<string, any> = {}) {
  const _id = overrides['_id'] || new Types.ObjectId()
  const orgId = overrides['orgId'] || new Types.ObjectId()

  return {
    _id,
    orgId,
    brandId: null,
    pipelineId: null,
    userId: 'user-1',
    taskType: 'remix',
    status: 'completed',
    sourceVideoUrl: 'https://cdn.example.com/source.mp4',
    outputVideoUrl: `https://cdn.example.com/${_id.toString()}.mp4`,
    copy: {
      title: '春季上新短片',
      subtitle: '测试副标题',
      hashtags: ['#测试'],
      blueWords: ['转化'],
      commentGuide: '评论引导',
      commentGuides: ['评论引导 1'],
    },
    metadata: {},
    createdAt: new Date('2026-03-30T08:00:00.000Z'),
    updatedAt: new Date('2026-03-30T08:00:00.000Z'),
    ...overrides,
  }
}

describe('contentMgmtService export behavior', () => {
  let videoTaskModel: Record<string, any>
  let organizationModel: Record<string, any>
  let subscriptionModel: Record<string, any>
  let mediaClawUserModel: Record<string, any>
  let notificationService: Record<string, any>
  let webhookService: Record<string, any>
  let service: ContentMgmtService

  beforeEach(() => {
    videoTaskModel = {
      find: vi.fn(),
      findOne: vi.fn(),
    }
    organizationModel = {}
    subscriptionModel = {}
    mediaClawUserModel = {}
    notificationService = { send: vi.fn().mockResolvedValue(undefined) }
    webhookService = { trigger: vi.fn().mockResolvedValue(undefined) }

    service = new ContentMgmtService(
      videoTaskModel as any,
      organizationModel as any,
      subscriptionModel as any,
      mediaClawUserModel as any,
      notificationService as any,
      webhookService as any,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应导出可被 Excel 打开的 SpreadsheetML 文件', async () => {
    const task = createTask()
    videoTaskModel.find.mockReturnValue(createQuery([task]))

    const result = await service.exportContent(task.orgId.toString(), 'excel', {})

    expect(result.format).toBe('excel')
    expect(result.mimeType).toBe('application/vnd.ms-excel')
    expect(result.data).toContain('<?mso-application progid="Excel.Sheet"?>')
    expect(result.data).toContain('春季上新短片')
  })

  it('应将多种导出格式打包到 zip 中', async () => {
    const task = createTask()
    videoTaskModel.find.mockReturnValue(createQuery([task]))

    const result = await service.exportContent(task.orgId.toString(), 'zip', {})
    const zip = new AdmZip(Buffer.from(result.data, 'base64'))
    const entryNames = zip.getEntries().map(entry => entry.entryName)

    expect(result.format).toBe('zip')
    expect(entryNames).toContain('content-export.json')
    expect(entryNames).toContain('content-export.csv')
    expect(entryNames).toContain('content-export.xls')
    expect(entryNames).toContain('manifest.json')
  })

  it('应生成包含视频文件与 manifest 的批量下载 zip', async () => {
    const task = createTask()
    videoTaskModel.findOne.mockImplementation((query: Record<string, any>) =>
      createQuery(query['_id']?.toString() === task._id.toString() ? task : null),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4]).buffer),
      }),
    )

    const result = await service.batchDownload(
      task.orgId.toString(),
      [task._id.toString()],
      'zip',
    )
    const zip = new AdmZip(Buffer.from(result.data, 'base64'))
    const entryNames = zip.getEntries().map(entry => entry.entryName)
    const manifest = zip.getEntries().find(entry => entry.entryName === 'manifest.json')

    expect(result.format).toBe('zip')
    expect(entryNames.some(name => name.endsWith('.mp4'))).toBe(true)
    expect(manifest).toBeDefined()
    expect(manifest?.getData().toString('utf-8')).toContain(task._id.toString())
  })
})
