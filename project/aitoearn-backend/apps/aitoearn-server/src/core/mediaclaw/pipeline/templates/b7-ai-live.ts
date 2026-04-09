import { Injectable } from '@nestjs/common'
import { PipelineType } from '@yikart/mongodb'
import { BasePipelineTemplate, TemplateResult, TemplateRunParams } from './base-template'

@Injectable()
export class B7AiLiveTemplate extends BasePipelineTemplate {
  readonly templateId = 'b7-ai-live'
  readonly type = PipelineType.SEEDING

  async run(input: TemplateRunParams): Promise<TemplateResult> {
    const params = this.asRecord(input.params)
    const styleParams = this.asRecord(params['styleParams'])
    const productImages = this.requireStringList(
      params['productImages'] || params['productImageUrls'],
      'params.productImages',
    )
    const aspectRatio = this.normalizeOptionalString(params['aspectRatio']) || input.brand.aspectRatio || '9:16'
    const duration = this.clampNumber(params['duration'], 5, 8, 5)
    const platforms = this.normalizeStringList(params['platforms']).length > 0
      ? this.normalizeStringList(params['platforms'])
      : ['douyin', 'xiaohongshu', 'kuaishou']
    const visualStyle = this.normalizeOptionalString(styleParams['visualStyle'])
      || this.normalizeOptionalString(params['visualStyle'])
      || 'AI 微动效种草'
    const tone = this.normalizeOptionalString(styleParams['tone'])
      || this.normalizeOptionalString(params['tone'])
      || '高频轻量种草'
    const mutationDomains = this.normalizeStringList(styleParams['mutationDomains']).length > 0
      ? this.normalizeStringList(styleParams['mutationDomains'])
      : [
          'lighting direction',
          'background elements',
          'props styling',
          'color temperature',
        ]

    return {
      templateId: this.templateId,
      name: this.normalizeOptionalString(input.pipelineName) || `${input.brand.name} AI 微动效线`,
      description: this.normalizeOptionalString(input.description)
        || `${input.brand.name} 品牌素材 + 商品图经 Kling/Seedance i2v 生成 5 秒微动效视频`,
      type: this.type,
      styleConfig: {
        duration,
        aspectRatio,
        tone,
        visualStyle,
        platforms,
        brandAssets: this.createBrandAssets(input.brand),
        styleRewrite: {
          enabled: true,
          scope: 'shared',
          preserveComposition: true,
          preserveProductPlacement: true,
          mutationDomains,
        },
      },
      distributionRules: {
        preferredPlatforms: platforms,
        templateIds: [this.templateId],
        preferredCategories: this.normalizeStringList(params['categories']),
        strategy: 'round-robin',
      },
      preferences: {
        preferredStyles: this.normalizeStringList([
          'micro-motion',
          'daily-refresh',
          visualStyle,
          ...input.brand.keywords.slice(0, 2),
        ]),
        avoidStyles: this.normalizeStringList(params['avoidStyles']),
        preferredDuration: duration,
        aspectRatio,
        subtitlePreferences: {
          templateId: this.templateId,
          workflow: 'brand_assets -> product_images -> kling/seedance i2v -> 5s video',
          coverStyle: 'black_bg_white_text',
          musicStyle: 'micro-motion',
          productImages,
          styleParams,
          templateRuntime: {
            primaryEngine: 'kling/seedance-i2v',
            deliveryMode: 'fast_batch',
            costMode: 'ai_video',
          },
        },
      },
      modelOverrides: {
        videoGen: this.normalizeOptionalString(params['videoGenModel']) || 'kling-v3-omni',
      },
      runtime: this.buildRuntimeProfile(
        {
          productImages,
          styleParams,
          platforms,
          duration,
        },
        {
          version: '1.0',
          estimatedCost: 15.1,
          estimatedDurationSec: 300,
          costMode: 'ai_video',
          requiredInputs: ['brand_assets', 'product_images'],
          optionalInputs: ['style_params', 'subtitle_text'],
          stages: [
            { name: 'asset_ingest', engine: 'brand-assets', output: 'template context' },
            { name: 'i2v_generate', engine: 'kling/seedance', output: '5s branded video' },
            { name: 'cover_finalize', engine: 'seedream + ffmpeg', output: 'cover + final edit' },
          ],
        },
      ),
    }
  }
}
