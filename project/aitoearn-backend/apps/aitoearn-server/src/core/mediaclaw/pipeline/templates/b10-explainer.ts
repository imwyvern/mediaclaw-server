import { Injectable } from '@nestjs/common'
import { PipelineType } from '@yikart/mongodb'
import { BasePipelineTemplate, TemplateResult, TemplateRunParams } from './base-template'

@Injectable()
export class B10ExplainerTemplate extends BasePipelineTemplate {
  readonly templateId = 'b10-explainer'
  readonly type = PipelineType.BRAND_STORY

  async run(input: TemplateRunParams): Promise<TemplateResult> {
    const params = this.asRecord(input.params)
    const topic = this.requireString(params['topic'], 'params.topic')
    const script = this.requireString(params['script'], 'params.script')
    const bulletPoints = this.normalizeStringList(params['bulletPoints'])
    const aspectRatio = this.normalizeOptionalString(params['aspectRatio']) || input.brand.aspectRatio || '9:16'
    const estimatedDuration = Math.ceil(script.length / 14)
    const duration = this.clampNumber(params['duration'], 15, 90, Math.max(30, estimatedDuration))
    const platforms = this.normalizeStringList(params['platforms']).length > 0
      ? this.normalizeStringList(params['platforms'])
      : ['douyin', 'bilibili', 'xiaohongshu']
    const tone = this.normalizeOptionalString(params['tone']) || '知识讲解'
    const visualStyle = this.normalizeOptionalString(params['visualStyle']) || '教育型信息流'

    return {
      templateId: this.templateId,
      name: this.normalizeOptionalString(input.pipelineName) || `${input.brand.name} 讲解视频线`,
      description: this.normalizeOptionalString(input.description)
        || `${topic} 讲解脚本通过 Remotion 渲染成竖版 explainer 视频`,
      type: this.type,
      styleConfig: {
        duration,
        aspectRatio,
        tone,
        visualStyle,
        platforms,
        brandAssets: this.createBrandAssets(input.brand),
        styleRewrite: {
          enabled: false,
          scope: 'shared',
          preserveComposition: true,
          preserveProductPlacement: true,
          mutationDomains: [],
        },
      },
      distributionRules: {
        preferredPlatforms: platforms,
        templateIds: [this.templateId],
        preferredCategories: this.normalizeStringList(params['categories']),
        strategy: 'scheduled',
      },
      preferences: {
        preferredStyles: this.normalizeStringList([
          'explainer',
          'educational',
          'remotion',
          ...bulletPoints,
        ]),
        avoidStyles: this.normalizeStringList(params['avoidStyles']),
        preferredDuration: duration,
        aspectRatio,
        subtitlePreferences: {
          templateId: this.templateId,
          workflow: 'topic + script -> remotion render -> educational video',
          topic,
          script,
          bulletPoints,
          zeroAiVideoCost: true,
          remotionComposition: this.normalizeOptionalString(params['composition']) || 'ExplainerVertical',
          templateRuntime: {
            primaryEngine: 'remotion',
            deliveryMode: 'render_only',
            costMode: 'render_only',
          },
        },
      },
      modelOverrides: {
        videoGen: 'remotion',
      },
      runtime: this.buildRuntimeProfile(
        {
          topic,
          scriptLength: script.length,
          bulletPoints,
          duration,
          platforms,
        },
        {
          version: '1.0',
          estimatedCost: 0,
          estimatedDurationSec: 420,
          costMode: 'render_only',
          requiredInputs: ['topic', 'script'],
          optionalInputs: ['bullet_points', 'brand_assets'],
          stages: [
            { name: 'script_parse', engine: 'template parser', output: 'scene outline' },
            { name: 'remotion_render', engine: 'remotion', output: 'vertical explainer video' },
            { name: 'caption_finalize', engine: 'subtitle renderer', output: 'branded final video' },
          ],
        },
      ),
    }
  }
}
