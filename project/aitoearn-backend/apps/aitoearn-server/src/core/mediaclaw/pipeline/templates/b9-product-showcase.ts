import { Injectable } from '@nestjs/common'
import { PipelineType } from '@yikart/mongodb'
import { BasePipelineTemplate, TemplateResult, TemplateRunParams } from './base-template'

@Injectable()
export class B9ProductShowcaseTemplate extends BasePipelineTemplate {
  readonly templateId = 'b9-product-showcase'
  readonly type = PipelineType.NEW_PRODUCT

  async run(input: TemplateRunParams): Promise<TemplateResult> {
    const params = this.asRecord(input.params)
    const styleParams = this.asRecord(params['styleParams'])
    const referenceVideoUrl = this.requireString(
      params['referenceVideoUrl'] || input.brand.referenceVideoUrl,
      'params.referenceVideoUrl',
    )
    const overlayAssets = this.normalizeStringList(params['brandOverlayAssets'])
    const aspectRatio = this.normalizeOptionalString(params['aspectRatio']) || input.brand.aspectRatio || '9:16'
    const duration = this.clampNumber(params['duration'], 12, 45, 20)
    const platforms = this.normalizeStringList(params['platforms']).length > 0
      ? this.normalizeStringList(params['platforms'])
      : ['douyin', 'xiaohongshu']
    const visualStyle = this.normalizeOptionalString(styleParams['visualStyle'])
      || this.normalizeOptionalString(params['visualStyle'])
      || '高还原产品展示'
    const tone = this.normalizeOptionalString(styleParams['tone'])
      || this.normalizeOptionalString(params['tone'])
      || '精致对标复刻'
    const mutationDomains = this.normalizeStringList(styleParams['mutationDomains']).length > 0
      ? this.normalizeStringList(styleParams['mutationDomains'])
      : [
          'scene props',
          'lighting direction',
          'camera motion pacing',
          'background elements',
        ]

    return {
      templateId: this.templateId,
      name: this.normalizeOptionalString(input.pipelineName) || `${input.brand.name} 对标展示线`,
      description: this.normalizeOptionalString(input.description)
        || `${input.brand.name} 参考视频复刻与品牌叠层改写后生成的产品展示视频`,
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
          scope: 'per_scene',
          preserveComposition: true,
          preserveProductPlacement: true,
          mutationDomains,
        },
      },
      distributionRules: {
        preferredPlatforms: platforms,
        templateIds: [this.templateId],
        preferredCategories: this.normalizeStringList(params['categories']),
        strategy: 'priority',
      },
      preferences: {
        preferredStyles: this.normalizeStringList([
          'product-showcase',
          'reference-remix',
          visualStyle,
        ]),
        avoidStyles: this.normalizeStringList(params['avoidStyles']),
        preferredDuration: duration,
        aspectRatio,
        subtitlePreferences: {
          templateId: this.templateId,
          workflow: 'reference_video -> style rewrite -> i2v -> branded showcase',
          referenceVideoUrl,
          overlayAssets,
          storyboardMode: this.normalizeOptionalString(params['storyboardMode']) || 'auto',
          useReferenceAudio: true,
          styleParams,
          templateRuntime: {
            primaryEngine: 'style-rewrite + kling-i2v',
            deliveryMode: 'high_quality',
            costMode: 'ai_video',
          },
        },
      },
      modelOverrides: {
        frameEdit: this.normalizeOptionalString(params['frameEditModel']) || 'gemini-2.5-flash-image',
        videoGen: this.normalizeOptionalString(params['videoGenModel']) || 'kling-v3-omni',
      },
      runtime: this.buildRuntimeProfile(
        {
          referenceVideoUrl,
          overlayAssets,
          styleParams,
          duration,
          platforms,
        },
        {
          version: '1.0',
          estimatedCost: 28.6,
          estimatedDurationSec: 1200,
          costMode: 'ai_video',
          requiredInputs: ['brand_assets', 'reference_video_url'],
          optionalInputs: ['brand_overlay_assets', 'style_params'],
          stages: [
            { name: 'storyboard_extract', engine: 'reference analyzer', output: 'scene plan' },
            { name: 'scene_rewrite', engine: 'style rewrite', output: 'branded frames' },
            { name: 'i2v_generate', engine: 'kling/seedance', output: 'showcase segments' },
            { name: 'brand_overlay', engine: 'ffmpeg', output: 'branded final video' },
          ],
        },
      ),
    }
  }
}
