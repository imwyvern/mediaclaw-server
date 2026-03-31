import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyEngineService } from './copy-engine.service'

function createQuery<T>(value: T) {
  const query = {
    limit: vi.fn(),
    lean: vi.fn(),
    sort: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  return query
}

describe('CopyEngineService', () => {
  beforeEach(() => {
    delete process.env['MEDIACLAW_COPY_PROVIDER']
    delete process.env['MEDIACLAW_DEEPSEEK_API_KEY']
    delete process.env['MEDIACLAW_GEMINI_API_KEY']
  })

  it('should generate heuristic copy with blue words and 3 comment guides', async () => {
    const brandModel = {
      findById: vi.fn().mockReturnValue(createQuery({
        _id: { toString: () => 'brand-1' },
        name: '今斑堂',
        orgId: { toString: () => 'org-1' },
        assets: {
          keywords: ['护肤', '修护'],
          prohibitedWords: [],
        },
        videoStyle: {
          preferredDuration: 15,
          aspectRatio: '9:16',
          subtitleStyle: {},
          referenceVideoUrl: '',
        },
      })),
    }
    const copyHistoryModel = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }

    const service = new CopyEngineService(brandModel as any, copyHistoryModel as any)
    const result = await service.generateCopy('brand-1', 'https://cdn.example.com/video.mp4', {
      scene: '新品上架',
      taskId: '507f1f77bcf86cd799439011',
    })

    expect(result.title.length).toBeLessThanOrEqual(60)
    expect(result.hashtags.length).toBeGreaterThanOrEqual(5)
    expect(result.blueWords.length).toBeGreaterThan(0)
    expect(result.commentGuides).toHaveLength(3)
    expect(result.commentGuide.split('\n')).toHaveLength(3)
  })

  it('should normalize unstable llm output into valid copy payload', async () => {
    const brandModel = {
      findById: vi.fn().mockReturnValue(createQuery({
        _id: { toString: () => 'brand-2' },
        name: 'MediaClaw',
        orgId: { toString: () => 'org-2' },
        assets: {
          keywords: ['营销', '增长'],
          prohibitedWords: ['最强'],
        },
        videoStyle: {
          preferredDuration: 15,
          aspectRatio: '9:16',
          subtitleStyle: {},
          referenceVideoUrl: '',
        },
      })),
    }
    const copyHistoryModel = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }

    const service = new CopyEngineService(brandModel as any, copyHistoryModel as any)
    vi.spyOn(service as any, 'generateWithProvider').mockResolvedValue({
      title: '超短标题',
      subtitle: '太短',
      hashtags: ['增长'],
      blueWords: [],
      commentGuides: ['只给一条'],
    })

    const result = await service.generateCopy('brand-2', 'https://cdn.example.com/video.mp4', {
      platform: 'xiaohongshu',
    })

    expect(result.subtitle.length).toBeGreaterThanOrEqual(15)
    expect(result.hashtags.length).toBeGreaterThanOrEqual(5)
    expect(result.commentGuides).toHaveLength(3)
    expect(result.blueWords.length).toBeGreaterThan(0)
  })
})
