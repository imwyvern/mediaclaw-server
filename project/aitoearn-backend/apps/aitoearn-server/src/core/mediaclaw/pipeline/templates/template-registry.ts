import { Injectable, NotFoundException } from '@nestjs/common'
import { B7AiLiveTemplate } from './b7-ai-live'
import { B9ProductShowcaseTemplate } from './b9-product-showcase'
import { B10ExplainerTemplate } from './b10-explainer'
import {
  BasePipelineTemplate,
  TemplateResult,
  TemplateRunParams,
} from './base-template'

@Injectable()
export class TemplateRegistry {
  private readonly templates: BasePipelineTemplate[]

  constructor(
    b7AiLiveTemplate: B7AiLiveTemplate,
    b9ProductShowcaseTemplate: B9ProductShowcaseTemplate,
    b10ExplainerTemplate: B10ExplainerTemplate,
  ) {
    this.templates = [
      b7AiLiveTemplate,
      b9ProductShowcaseTemplate,
      b10ExplainerTemplate,
    ]
  }

  list() {
    return [...this.templates]
  }

  get(templateType: string) {
    const normalized = templateType.trim()
    return this.templates.find(template => template.templateId === normalized) || null
  }

  async run(templateType: string, params: TemplateRunParams): Promise<TemplateResult> {
    const template = this.get(templateType)
    if (!template) {
      throw new NotFoundException(`Template ${templateType} not found`)
    }

    return template.run(params)
  }
}
