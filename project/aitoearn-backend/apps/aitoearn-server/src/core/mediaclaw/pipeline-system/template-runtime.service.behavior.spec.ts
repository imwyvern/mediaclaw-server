import { describe, expect, it } from 'vitest'
import { TemplateRuntimeService } from './template-runtime.service'

describe('templateRuntimeService', () => {
  it('应从 templates 目录加载 b7 和 b9 模板运行时清单', async () => {
    const service = new TemplateRuntimeService()

    const templates = await service.listTemplates()
    const templateIds = templates.map(item => item.templateId)

    expect(templateIds).toContain('b7-ai-live')
    expect(templateIds).toContain('b9-product-showcase')

    const b7 = templates.find(item => item.templateId === 'b7-ai-live')
    expect(b7).toMatchObject({
      name: 'AI 微动视频',
      category: 'fast_batch',
      estimatedTimeSec: 300,
      requiredInputs: ['brand_assets'],
    })
    expect(b7?.runtime.entrypoint.endsWith('/templates/b7-ai-live/run.py')).toBe(true)
  })
})
