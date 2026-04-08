import { describe, expect, it, vi } from 'vitest'
import { CopyController } from './copy.controller'
import { CopyService } from './copy.service'
import { StyleRewriteService } from './style-rewrite.service'

describe('copyModule smoke', () => {
  it('service can be instantiated with copy dependencies', () => {
    const service = new CopyService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    )

    expect(service).toBeInstanceOf(CopyService)
    expect(service.generateCopy).toBeTypeOf('function')
  })

  it('controller can be instantiated with copy services', () => {
    const controller = new CopyController(
      {
        generateForHttp: vi.fn(),
        rewriteForHttp: vi.fn(),
        generateBlueWords: vi.fn(),
        generateCommentGuide: vi.fn(),
        generateABVariants: vi.fn(),
        recordPerformance: vi.fn(),
        listHistory: vi.fn(),
        getHistory: vi.fn(),
        getInsights: vi.fn(),
        getTopPatterns: vi.fn(),
      } as unknown as CopyService,
      {
        rewriteForPlatform: vi.fn(),
      } as unknown as StyleRewriteService,
    )

    expect(controller).toBeInstanceOf(CopyController)
    expect(controller.generateCopy).toBeTypeOf('function')
    expect(controller.getHistory).toBeTypeOf('function')
  })
})
