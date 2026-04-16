import { Injectable, Logger } from '@nestjs/common'
import {
  runAiLivePipeline,
  runExplainerPipeline,
  runProductShowcasePipeline,
  type AiLiveToolbox,
  type ExplainerToolbox,
  type PipelineEvent,
  type PipelineToolbox,
} from '@yikart/mediaclaw-agent-runtime'
import {
  type AiLivePipelineInput,
  type AssetRef,
  type BrandProfile,
  type ContentPlannerInput,
  type ExplainerPipelineInput,
  type ImageAssetRef,
  type PlatformPackagerInput,
  type ProductProfile,
  type ProductShowcasePipelineInput,
  type RemixBriefInput,
  type SceneCut,
  type VideoAssetRef,
} from '@yikart/mediaclaw-shared-kernel'
import { scriptWriter, ttsEngine } from '@yikart/mediaclaw-tools-audio-text'
import { brandReplacer } from '@yikart/mediaclaw-tools-branding'
import { finalComposer, videoAssembler } from '@yikart/mediaclaw-tools-compose'
import { videoGenerator } from '@yikart/mediaclaw-tools-generation'
import { motionAnalyzer, sceneCutter, videoDownload } from '@yikart/mediaclaw-tools-ingest'
import {
  contentPlanner,
  performanceInsight,
  remixBrief,
  trendingScout,
} from '@yikart/mediaclaw-tools-intelligence'
import { platformPackager } from '@yikart/mediaclaw-tools-platform'
import { contentReviewer, dedupGatekeeper, qaOptimizer } from '@yikart/mediaclaw-tools-quality'
import type {
  AiLiveDtoData,
  BrandProfileDtoData,
  ContentPlannerDtoData,
  CreateRemixBriefDtoData,
  ExplainerDtoData,
  MediaclawPlatform,
  ModelAllocationDtoData,
  PlatformPackagerDtoData,
  ProductProfileDtoData,
  ProductShowcaseDtoData,
  TrendingScoutDtoData,
} from './mediaclaw.dto'
import type {
  ContentPlannerVoData,
  PerformanceInsightVoData,
  PipelineResultVoData,
  PlatformPackagerVoData,
  RemixBriefVoData,
  TrendingScoutVoData,
} from './mediaclaw.vo'

@Injectable()
export class MediaclawService {
  private readonly logger = new Logger(MediaclawService.name)

  async runProductShowcase(
    input: ProductShowcaseDtoData,
    onPipelineEvent?: (event: PipelineEvent) => void | Promise<void>,
  ): Promise<PipelineResultVoData> {
    this.logger.log('Starting ProductShowcase pipeline')

    const pipelineInput = this.toProductShowcasePipelineInput(input)
    const toolbox: PipelineToolbox = {
      videoDownload: (toolInput) => this.adaptVideoDownload(toolInput),
      sceneCutter: (toolInput) => this.adaptSceneCutter(toolInput),
      motionAnalyzer: (toolInput) => this.adaptMotionAnalyzer(toolInput),
      brandReplacer: (toolInput) =>
        this.adaptBrandReplacer(toolInput, pipelineInput.targetBrand, pipelineInput.targetProduct),
      videoGenerator: (toolInput) => this.adaptVideoGenerator(toolInput),
      scriptWriter: (toolInput) => this.adaptScriptWriter(toolInput),
      ttsEngine: (toolInput) => this.adaptTtsEngine(toolInput),
      videoAssembler: (toolInput) => this.adaptVideoAssembler(toolInput),
      finalComposer: (toolInput) => this.adaptFinalComposer(toolInput),
      qaOptimizer: (toolInput) => this.adaptQaOptimizer(toolInput),
      dedupGatekeeper: (toolInput) => this.adaptDedupGatekeeper(toolInput),
      contentReviewer: (toolInput) => this.adaptContentReviewer(toolInput),
    }

    const result = await runProductShowcasePipeline(pipelineInput, toolbox, (event) => {
      this.logger.debug(`[${event.step}] ${event.toolId}: ${event.status} (${event.durationMs}ms)`)
      void Promise.resolve(onPipelineEvent?.(event)).catch((error: unknown) => {
        this.logger.warn(`Failed to report pipeline event: ${this.getErrorMessage(error)}`)
      })
    })

    return this.toPipelineResultVo(result)
  }

  async runAiLive(input: AiLiveDtoData): Promise<PipelineResultVoData> {
    this.logger.log('Starting AiLive pipeline')

    const toolbox: AiLiveToolbox = {
      videoGenerator: (toolInput) => this.adaptVideoGenerator(toolInput),
      videoAssembler: (toolInput) => this.adaptVideoAssembler(toolInput),
      finalComposer: (toolInput) => this.adaptFinalComposer(toolInput),
      qaOptimizer: (toolInput) => this.adaptQaOptimizer(toolInput),
    }

    const result = await runAiLivePipeline(this.toAiLivePipelineInput(input), toolbox)
    return this.toPipelineResultVo(result)
  }

  async runExplainer(input: ExplainerDtoData): Promise<PipelineResultVoData> {
    this.logger.log('Starting Explainer pipeline')

    const toolbox: ExplainerToolbox = {
      remotionRender: async () => {
        throw new Error('Remotion not configured')
      },
      scriptWriter: (toolInput) => this.adaptScriptWriter(toolInput),
      ttsEngine: (toolInput) => this.adaptTtsEngine(toolInput),
      finalComposer: (toolInput) => this.adaptFinalComposer(toolInput),
      qaOptimizer: (toolInput) => this.adaptQaOptimizer(toolInput),
    }

    const result = await runExplainerPipeline(this.toExplainerPipelineInput(input), toolbox)
    return this.toPipelineResultVo(result)
  }

  async createRemixBrief(input: CreateRemixBriefDtoData): Promise<RemixBriefVoData> {
    return await remixBrief(this.toRemixBriefInput(input))
  }

  async scoutTrending(input: TrendingScoutDtoData): Promise<TrendingScoutVoData> {
    return await trendingScout(input)
  }

  async planContent(input: ContentPlannerDtoData): Promise<ContentPlannerVoData> {
    return await contentPlanner(this.toContentPlannerInput(input))
  }

  async packageForPlatform(input: PlatformPackagerDtoData): Promise<PlatformPackagerVoData> {
    const video = {
      assetId: input.videoAssetId,
      storageKey: `/tmp/${input.videoAssetId}.mp4`,
      sha256: 'placeholder',
      mimeType: 'video/mp4' as const,
      durationSec: 15,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: true,
    }

    const platformInput: PlatformPackagerInput = {
      video,
      platform: input.platform,
      brand: toBrandProfile(input.brand),
      product: toProductProfile(input.product),
    }

    return await platformPackager(platformInput)
  }

  async getInsight(videoId: string, platform: string): Promise<PerformanceInsightVoData> {
    return await performanceInsight({
      mode: 'realtime',
      videoId,
      platform: this.normalizePlatform(platform),
    })
  }

  async getMonthlyInsight(orgId: string, period: string): Promise<PerformanceInsightVoData> {
    return await performanceInsight({ mode: 'monthly', orgId, period })
  }

  private adaptVideoDownload(
    input: Parameters<PipelineToolbox['videoDownload']>[0],
  ): ReturnType<PipelineToolbox['videoDownload']> {
    return videoDownload({ sourceUrl: input.sourceUrl })
  }

  private adaptSceneCutter(
    input: Parameters<PipelineToolbox['sceneCutter']>[0],
  ): ReturnType<PipelineToolbox['sceneCutter']> {
    return sceneCutter({
      video: input.video,
      extractFirstFrame: true,
    })
  }

  private adaptMotionAnalyzer(
    input: Parameters<PipelineToolbox['motionAnalyzer']>[0],
  ): ReturnType<PipelineToolbox['motionAnalyzer']> {
    return motionAnalyzer({
      cuts: input.cuts,
    })
  }

  private async adaptBrandReplacer(
    input: Parameters<PipelineToolbox['brandReplacer']>[0],
    targetBrand: BrandProfile,
    targetProduct: ProductProfile,
  ): Promise<Awaited<ReturnType<PipelineToolbox['brandReplacer']>>> {
    const replacement = await brandReplacer({
      sourceFrame: buildFramePreview(input.video),
      targetBrand,
      targetProduct,
    })

    return {
      video: input.video,
      meta: replacement.meta,
    }
  }

  private adaptVideoGenerator(
    input: Parameters<PipelineToolbox['videoGenerator']>[0],
  ): ReturnType<PipelineToolbox['videoGenerator']> {
    return videoGenerator({
      firstFrame: input.firstFrame,
      motionPrompt: input.motionPrompt,
      model: this.normalizeVideoModel(input.model),
      durationSec: input.durationSec,
      seed: input.seed,
    })
  }

  private adaptScriptWriter(
    input: Parameters<PipelineToolbox['scriptWriter']>[0],
  ): ReturnType<PipelineToolbox['scriptWriter']> {
    return scriptWriter({
      style: this.normalizeScriptStyle(input.style),
      language: 'zh-CN',
      brand: normalizeBrandProfile(input.brand),
      product: normalizeProductProfile(input.product),
    })
  }

  private adaptTtsEngine(
    input: Parameters<PipelineToolbox['ttsEngine']>[0],
  ): ReturnType<PipelineToolbox['ttsEngine']> {
    return ttsEngine({
      lines: input.lines,
      voiceId: input.voiceId,
      payloadFormat: 'req_params',
    })
  }

  private adaptVideoAssembler(
    input: Parameters<PipelineToolbox['videoAssembler']>[0],
  ): ReturnType<PipelineToolbox['videoAssembler']> {
    return videoAssembler({
      shots: input.shots,
      transitionType: 'cut',
    })
  }

  private adaptFinalComposer(
    input: Parameters<PipelineToolbox['finalComposer']>[0],
  ): ReturnType<PipelineToolbox['finalComposer']> {
    return finalComposer({
      video: input.video,
      ttsAudio: isAssetRef(input.ttsAudio) ? input.ttsAudio : undefined,
    })
  }

  private adaptQaOptimizer(
    input: Parameters<PipelineToolbox['qaOptimizer']>[0],
  ): ReturnType<PipelineToolbox['qaOptimizer']> {
    return qaOptimizer({
      video: input.video,
      attempt: input.attempt,
    })
  }

  private adaptDedupGatekeeper(
    input: Parameters<PipelineToolbox['dedupGatekeeper']>[0],
  ): ReturnType<PipelineToolbox['dedupGatekeeper']> {
    return dedupGatekeeper({
      video: input.video,
    })
  }

  private adaptContentReviewer(
    input: Parameters<PipelineToolbox['contentReviewer']>[0],
  ): ReturnType<PipelineToolbox['contentReviewer']> {
    return contentReviewer({
      platform: this.normalizePlatform(input.platform),
      title: input.title,
      description: input.description,
    })
  }

  private toPipelineResultVo(
    result: Omit<PipelineResultVoData, 'state'> & { state?: PipelineResultVoData['state'] },
  ): PipelineResultVoData {
    if (result.state !== undefined) {
      return {
        ...result,
        state: result.state,
      }
    }

    const state: PipelineResultVoData['state'] = result.finalVideo.assetId
      ? (result.qualityReport.passed ? 'QA_PASSED' : 'PRODUCING')
      : 'SUSPENDED'

    return {
      ...result,
      state,
    }
  }

  private toProductShowcasePipelineInput(
    input: ProductShowcaseDtoData,
  ): ProductShowcasePipelineInput {
    return {
      brief: {
        ...input.brief,
        cuts: input.brief.cuts.map((cut) => toSceneCut(cut)),
      },
      targetBrand: toBrandProfile(input.targetBrand),
      targetProduct: toProductProfile(input.targetProduct),
      qualityLevel: input.qualityLevel,
    }
  }

  private toAiLivePipelineInput(input: AiLiveDtoData): AiLivePipelineInput {
    return {
      ...input,
      productImages: input.productImages.map((image) => ({ ...image })),
    }
  }

  private toExplainerPipelineInput(input: ExplainerDtoData): ExplainerPipelineInput {
    return {
      product: toProductProfile(input.product),
      templateId: input.templateId,
      durationSec: input.durationSec,
    }
  }

  private toRemixBriefInput(input: CreateRemixBriefDtoData): RemixBriefInput {
    return {
      referenceUrl: input.referenceUrl,
      targetBrand: toBrandProfile(input.targetBrand),
      targetProduct: toProductProfile(input.targetProduct),
    }
  }

  private toContentPlannerInput(input: ContentPlannerDtoData): ContentPlannerInput {
    return {
      ...input,
      brand: toBrandProfile(input.brand),
      products: input.products.map((product) => toProductProfile(product)),
    }
  }

  private normalizePlatform(platform: string): MediaclawPlatform {
    return isMediaclawPlatform(platform) ? platform : 'douyin'
  }

  private normalizeVideoModel(model: string): ModelAllocationDtoData['model'] {
    return isVideoModel(model) ? model : 'seedance-1.5'
  }

  private normalizeScriptStyle(style: string): 'seed' | 'review' | 'story' {
    if (style === 'review' || style === 'story') {
      return style
    }

    return 'seed'
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}

function isMediaclawPlatform(platform: string): platform is MediaclawPlatform {
  return ['douyin', 'xhs', 'kuaishou', 'bilibili'].includes(platform)
}

function isVideoModel(model: string): model is ModelAllocationDtoData['model'] {
  return ['seedance-2.0', 'seedance-1.5', 'kling', 'remotion'].includes(model)
}

function normalizeBrandProfile(value: unknown): BrandProfile | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  if (
    typeof value['brandId'] !== 'string'
    || typeof value['brandName'] !== 'string'
    || typeof value['industry'] !== 'string'
  ) {
    return undefined
  }

  const toneTags = Array.isArray(value['toneTags'])
    ? value['toneTags'].filter((tag): tag is string => typeof tag === 'string')
    : undefined

  return {
    brandId: value['brandId'],
    brandName: value['brandName'],
    industry: value['industry'],
    slogan: typeof value['slogan'] === 'string' ? value['slogan'] : undefined,
    toneTags,
  }
}

function normalizeProductProfile(value: unknown): ProductProfile | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  if (typeof value['productId'] !== 'string' || typeof value['name'] !== 'string') {
    return undefined
  }

  const rawFeatures = value['features']
  if (!Array.isArray(rawFeatures) || rawFeatures.some((feature) => typeof feature !== 'string')) {
    return undefined
  }

  const rawImages = value['images']
  if (!Array.isArray(rawImages)) {
    return undefined
  }

  if (rawImages.every((image) => typeof image === 'string')) {
    return toProductProfile({
      productId: value['productId'],
      name: value['name'],
      features: rawFeatures,
      images: rawImages,
    })
  }

  if (rawImages.every((image): image is ImageAssetRef => isImageAssetRef(image))) {
    return {
      productId: value['productId'],
      name: value['name'],
      features: rawFeatures,
      images: rawImages,
    }
  }

  return undefined
}

function isAssetRef(value: unknown): value is AssetRef {
  return isRecord(value)
    && typeof value['assetId'] === 'string'
    && typeof value['storageKey'] === 'string'
    && typeof value['sha256'] === 'string'
    && typeof value['mimeType'] === 'string'
}

function isImageAssetRef(value: unknown): value is ImageAssetRef {
  return isRecord(value)
    && typeof value['assetId'] === 'string'
    && typeof value['storageKey'] === 'string'
    && typeof value['sha256'] === 'string'
    && typeof value['mimeType'] === 'string'
    && typeof value['width'] === 'number'
    && typeof value['height'] === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function buildFramePreview(video: VideoAssetRef): ImageAssetRef {
  return {
    assetId: `${video.assetId}_preview`,
    storageKey: video.storageKey,
    url: video.url,
    sha256: video.sha256,
    mimeType: 'image/jpeg',
    width: video.width,
    height: video.height,
  }
}

function toBrandProfile(brand: BrandProfileDtoData): BrandProfile {
  return {
    brandId: brand.brandId,
    brandName: brand.brandName,
    industry: brand.industry,
  }
}

function toProductProfile(product: ProductProfileDtoData): ProductProfile {
  const images = product.images.length > 0
    ? product.images.map((image, index) => toImageAssetRef(image, `${product.productId}_image_${index}`))
    : [buildPlaceholderImage(`${product.productId}_placeholder`)]

  return {
    productId: product.productId,
    name: product.name,
    features: product.features,
    images,
  }
}

function toSceneCut(
  cut: ProductShowcaseDtoData['brief']['cuts'][number],
): SceneCut & { motionType?: string; motionPrompt?: string } {
  return {
    cutId: cut.cutId,
    startSec: cut.startSec,
    endSec: cut.endSec,
    firstFrame: buildPlaceholderImage(`${cut.cutId}_frame`),
    motionType: cut.motionType,
    motionPrompt: cut.motionPrompt,
  }
}

function toImageAssetRef(source: string, assetId: string): ImageAssetRef {
  return {
    assetId,
    storageKey: source,
    url: isHttpUrl(source) ? source : undefined,
    sha256: `placeholder_${assetId}`,
    mimeType: guessImageMimeType(source),
    width: 1080,
    height: 1920,
  }
}

function buildPlaceholderImage(assetId: string): ImageAssetRef {
  return {
    assetId,
    storageKey: `/tmp/${assetId}.jpg`,
    sha256: `placeholder_${assetId}`,
    mimeType: 'image/jpeg',
    width: 1080,
    height: 1920,
  }
}

function guessImageMimeType(pathOrUrl: string): 'image/png' | 'image/webp' | 'image/jpeg' {
  const normalized = pathOrUrl.toLowerCase()
  if (normalized.endsWith('.png')) {
    return 'image/png'
  }

  if (normalized.endsWith('.webp')) {
    return 'image/webp'
  }

  return 'image/jpeg'
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value)
}
