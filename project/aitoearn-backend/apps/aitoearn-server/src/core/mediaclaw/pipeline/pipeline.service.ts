import type { GeneratedCopy } from '../copy/copy.service'
import { copyFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand, Pipeline, PipelineStatus, VideoTask } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { ModelResolverService } from '../model-resolver/model-resolver.service'
import { BrandEditService } from './brand-edit.service'
import { DedupService } from './dedup.service'
import { DeepSynthesisMarkerService } from './deep-synthesis-marker.service'
import { FrameExtractService } from './frame-extract.service'
import { PipelinePreferenceLearningService } from './pipeline-preference-learning.service'
import {
  PipelineBrandProfile,
  PipelineJobContext,
  PipelineQualityReport,
  PipelineResolvedModels,
  PipelineStyleRewriteConfig,
  PipelineSubtitleVariant,
} from './pipeline.types'
import { buildPublicFileUrl, ensureDirectory, resolveRenderSize, runCommand } from './pipeline.utils'
import { QualityCheckService } from './quality-check.service'
import { SubtitleService } from './subtitle.service'
import { TemplateBrandContext, TemplateResult } from './templates/base-template'
import { TemplateRegistry } from './templates/template-registry'
import { MINIMAX_TTS_VOICE_IDS, TtsService } from './tts.service'
import { VideoGenService } from './video-gen.service'

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name)
  private readonly defaultStyleRewriteMutationDomains = [
    'table surface material',
    'tableware',
    'flowers',
    'ornaments',
    'lighting direction',
    'color temperature',
    'background elements',
  ]

  constructor(
    @InjectModel(Pipeline.name) private readonly pipelineModel: Model<Pipeline>,
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    private readonly frameExtractService: FrameExtractService,
    private readonly brandEditService: BrandEditService,
    private readonly videoGenService: VideoGenService,
    private readonly deepSynthesisMarkerService: DeepSynthesisMarkerService,
    private readonly subtitleService: SubtitleService,
    private readonly dedupService: DedupService,
    private readonly qualityCheckService: QualityCheckService,
    private readonly modelResolverService: ModelResolverService,
    private readonly pipelinePreferenceLearningService: PipelinePreferenceLearningService,
    private readonly templateRegistry: TemplateRegistry,
    @Optional() private readonly ttsService?: TtsService,
  ) {}

  async create(orgId: string, brandId: string, data: Record<string, any>) {
    const brand = await this.getOwnedBrandOrFail(orgId, brandId)
    const payload = await this.buildPipelinePayload(orgId, brand, data)
    return this.pipelineModel.create(payload)
  }

  async findByOrg(orgId: string) {
    return this.pipelineModel.find({
      orgId: new Types.ObjectId(orgId),
      status: { $ne: PipelineStatus.ARCHIVED },
    }).exec()
  }

  async findById(orgId: string, id: string) {
    const pipeline = await this.findOwnedPipeline(orgId, id)
    if (!pipeline) {
      throw new NotFoundException('Pipeline not found')
    }
    return pipeline
  }

  async update(orgId: string, id: string, data: Record<string, any>) {
    const pipeline = await this.requireOwnedPipeline(orgId, id)
    const brandId = this.normalizeOptionalString(data['brandId']) || pipeline.brandId.toString()
    const brand = await this.getOwnedBrandOrFail(orgId, brandId)

    return this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      await this.buildPipelinePayload(orgId, brand, data, pipeline),
      { new: true },
    ).exec()
  }

  async archive(orgId: string, id: string) {
    await this.findOwnedPipeline(orgId, id)
    return this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      { status: PipelineStatus.ARCHIVED },
      { new: true },
    ).exec()
  }

  async updatePreferences(orgId: string, id: string, preferences: Partial<Pipeline['preferences']>) {
    const pipeline = await this.requireOwnedPipeline(orgId, id)
    const normalizedPreferences = this.normalizePreferences(
      preferences as Record<string, any>,
      this.asRecord(pipeline.styleConfig),
      this.asRecord(pipeline.preferences),
    )

    return this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      { $set: { preferences: normalizedPreferences } },
      { new: true },
    ).exec()
  }

  async getPreferenceProfile(orgId: string, id: string) {
    const pipeline = await this.requireOwnedPipeline(orgId, id)
    const preferences = this.asRecord(pipeline.preferences) || {}

    return {
      pipelineId: pipeline._id.toString(),
      preferences,
      feedbackLog: Array.isArray(preferences['feedbackLog']) ? preferences['feedbackLog'] : [],
      learning: this.asRecord(preferences['preferenceLearning']) || {},
      styleConfig: this.asRecord(pipeline.styleConfig) || {},
      distributionRules: this.asRecord(pipeline.distributionRules) || {},
    }
  }

  async recordFeedback(orgId: string, id: string, input: Record<string, any>) {
    const pipeline = await this.requireOwnedPipeline(orgId, id)
    const pipelineRecord = (pipeline as any)?.toObject?.() || (pipeline as Record<string, any>)
    const currentPreferences = this.asRecord(pipelineRecord['preferences']) || {}
    const currentStyleConfig = this.asRecord(pipelineRecord['styleConfig']) || {}
    const currentDistributionRules = this.asRecord(pipelineRecord['distributionRules']) || {}
    const existingFeedbackLog = Array.isArray(currentPreferences['feedbackLog'])
      ? currentPreferences['feedbackLog'] as Array<Record<string, any>>
      : []
    const feedbackEntry = this.pipelinePreferenceLearningService.createFeedbackEntry(input)
    const feedbackLog = [...existingFeedbackLog, feedbackEntry].slice(-100)
    const learnedState = this.pipelinePreferenceLearningService.buildLearnedState(
      currentPreferences,
      currentStyleConfig,
      currentDistributionRules,
      feedbackLog,
    )

    const updated = await this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      {
        $set: {
          preferences: learnedState.preferences,
          styleConfig: learnedState.styleConfig,
          distributionRules: learnedState.distributionRules,
        },
      },
      { new: true },
    ).exec()

    return {
      pipelineId: id,
      feedback: feedbackEntry,
      preferences: this.asRecord(updated?.preferences) || learnedState.preferences,
      learning: this.asRecord(updated?.preferences?.['preferenceLearning']) || learnedState.preferenceLearning,
      styleConfig: this.asRecord(updated?.styleConfig) || learnedState.styleConfig,
      distributionRules: this.asRecord(updated?.distributionRules) || learnedState.distributionRules,
    }
  }

  async updateModelOverrides(orgId: string, id: string, overrides: Partial<Pipeline['modelOverrides']>) {
    const pipeline = await this.requireOwnedPipeline(orgId, id)
    const normalized = await this.modelResolverService.validatePipelineOverrides(
      orgId,
      {
        ...this.asRecord(pipeline.modelOverrides),
        ...(this.asRecord(overrides) || {}),
      },
    )
    return this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      {
        $set: {
          modelOverrides: {
            copy: normalized.copy || '',
            frameEdit: normalized.frameEdit || '',
            videoGen: normalized.videoGen || '',
          },
        },
      },
      { new: true },
    ).exec()
  }

  async updateDistributionRules(orgId: string, id: string, rules: Record<string, any>) {
    const pipeline = await this.requireOwnedPipeline(orgId, id)
    const normalized = this.normalizeDistributionRules(
      rules,
      this.asRecord(pipeline.distributionRules),
      this.asRecord(pipeline.styleConfig),
    )

    return this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      { $set: { distributionRules: normalized } },
      { new: true },
    ).exec()
  }

  async bindGroup(orgId: string, id: string, binding: Record<string, any>, boundBy: string) {
    const pipeline = await this.requireOwnedPipeline(orgId, id)
    const normalizedBinding = this.normalizeGroupBinding(binding, this.asRecord(pipeline.groupBinding), boundBy)

    return this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      {
        $set: {
          groupBinding: normalizedBinding,
          imGroupId: normalizedBinding.groupId,
        },
      },
      { new: true },
    ).exec()
  }

  async incrementVideoCount(id: string, field: 'totalVideosProduced' | 'totalVideosPublished') {
    return this.pipelineModel.findByIdAndUpdate(
      id,
      { $inc: { [field]: 1 } },
      { new: true },
    ).exec()
  }

  async analyzeSource(task: VideoTask): Promise<PipelineJobContext> {
    const workspaceDir = resolve(process.cwd(), 'tmp', 'mediaclaw-pipeline', task._id.toString())
    await ensureDirectory(workspaceDir)

    const sourceVideoPath = await this.frameExtractService.ensureLocalVideo(task.sourceVideoUrl, workspaceDir)
    const sourceMetadata = await this.frameExtractService.probeVideoMetadata(sourceVideoPath)
    const brand = await this.loadBrandProfile(task.brandId?.toString() || null)
    const pipeline = await this.loadPipelineDocument(task.pipelineId?.toString() || null)
    const models = await this.resolveModels(task.orgId?.toString() || null, pipeline?._id?.toString?.() || null)
    const templateId = this.resolveTemplateId(task.metadata, pipeline)
    const styleRewrite = this.resolveStyleRewriteConfig(task.metadata, pipeline, templateId)
    const targetDurationSeconds = this.resolveTargetDuration(
      task.metadata,
      brand.preferredDuration,
      pipeline?.styleConfig?.duration || pipeline?.preferences?.preferredDuration,
    )
    const aspectRatio = this.resolveAspectRatio(
      task.metadata,
      brand.aspectRatio,
      pipeline?.styleConfig?.aspectRatio || pipeline?.preferences?.aspectRatio,
    )
    const resolution = this.readString(task.metadata, 'resolution')
    const renderSize = resolveRenderSize(aspectRatio, resolution)
    const frameArtifacts = await this.frameExtractService.extractKeyFrames(
      sourceVideoPath,
      workspaceDir,
      sourceMetadata.durationSeconds || targetDurationSeconds,
    )

    return {
      taskId: task._id.toString(),
      orgId: task.orgId?.toString() || null,
      workspaceDir,
      templateId,
      sourceVideoPath,
      sourceMetadata,
      targetDurationSeconds,
      renderWidth: renderSize.width,
      renderHeight: renderSize.height,
      brand,
      styleRewrite,
      frameArtifacts,
      segmentVideoPaths: [],
      subtitles: this.buildSubtitleVariants(task, brand, targetDurationSeconds),
      dedupStrategy: this.dedupService.createStrategy(
        task._id.toString(),
        `${task.sourceVideoUrl}:${brand.name}`,
        brand.colors,
        sourceMetadata.hasAudio,
      ),
      preserveSourceAudio: sourceMetadata.hasAudio && this.readBoolean(task.metadata, 'reuseSourceAudio', true),
      prompts: {},
      models,
    }
  }

  async editFrames(context: PipelineJobContext): Promise<PipelineJobContext> {
    const { artifacts, result } = await this.brandEditService.applyBranding(context)
    return {
      ...context,
      frameArtifacts: artifacts,
      brandEditResult: result,
    }
  }

  async renderVideo(task: VideoTask, context: PipelineJobContext): Promise<PipelineJobContext> {
    const { segmentPaths, result } = await this.videoGenService.generateSegments(context)
    const composedVideoPath = await this.videoGenService.composeSegments(context, segmentPaths)
    const outputVideoUrl = await this.persistOutput(task._id.toString(), composedVideoPath)

    return {
      ...context,
      segmentVideoPaths: segmentPaths,
      composedVideoPath,
      outputVideoUrl,
      videoGenResult: result,
    }
  }

  async finalizeVideo(task: VideoTask, context: PipelineJobContext, copy: GeneratedCopy): Promise<PipelineJobContext> {
    const composedVideoPath = this.requirePath(context.composedVideoPath, 'composedVideoPath')
    const subtitles = this.buildCopySubtitleVariants(copy, context.brand, context.targetDurationSeconds)
    const deepSynthesisMarker = context.deepSynthesisMarker
      || this.deepSynthesisMarkerService.createMarker(task._id.toString(), context.brand)
    const subtitleResult = await this.subtitleService.renderSubtitles({
      ...context,
      subtitles,
      composedVideoPath,
      deepSynthesisMarker,
    })
    const finalVideoPath = join(context.workspaceDir, 'final.mp4')

    await this.dedupService.applyVideoPostProcess({
      inputVideoPath: subtitleResult.outputPath,
      outputVideoPath: finalVideoPath,
      strategy: context.dedupStrategy,
      preserveAudio: context.preserveSourceAudio,
    })

    const voiceover = await this.generateVoiceoverArtifact(task, context, copy)
    const resolvedFinalVideoPath = voiceover?.voiceoverPath
      ? await this.mixVoiceoverTrack(
          finalVideoPath,
          voiceover.voiceoverPath,
          join(context.workspaceDir, 'final-voiceover.mp4'),
          context.preserveSourceAudio && context.sourceMetadata.hasAudio,
        )
      : finalVideoPath
    const outputVideoUrl = await this.persistOutput(task._id.toString(), resolvedFinalVideoPath)

    return {
      ...context,
      subtitles,
      subtitledVideoPath: subtitleResult.outputPath,
      finalVideoPath: resolvedFinalVideoPath,
      outputVideoUrl,
      voiceoverPath: voiceover?.voiceoverPath,
      voiceoverUrl: voiceover?.voiceoverUrl,
      voiceoverMeta: voiceover?.voiceoverMeta,
      deepSynthesisMarker: subtitleResult.deepSynthesisMarker,
    }
  }

  async runQualityCheck(context: PipelineJobContext): Promise<PipelineQualityReport> {
    const finalVideoPath = this.requirePath(context.finalVideoPath || context.composedVideoPath, 'finalVideoPath')
    return this.qualityCheckService.assertQuality(
      finalVideoPath,
      context.targetDurationSeconds,
      context.subtitles.length > 0,
    )
  }

  async cleanupWorkspace(context?: PipelineJobContext | null) {
    if (!context?.workspaceDir) {
      return
    }

    await rm(context.workspaceDir, { recursive: true, force: true })
  }

  private async buildPipelinePayload(
    orgId: string,
    brand: Brand,
    data: Record<string, any>,
    existing?: Pipeline | null,
  ) {
    const existingRecord = existing ? ((existing as any)?.toObject?.() || (existing as Record<string, any>)) : null
    const templateResult = await this.resolveTemplateResult(brand, data, existingRecord)
    const templateBackedData = this.applyTemplateDefaults(data, templateResult)
    const templateId = this.normalizeOptionalString(templateBackedData['templateId']) || existingRecord?.['templateId'] || ''
    const styleConfig = this.normalizeStyleConfig(
      this.asRecord(templateBackedData['styleConfig']),
      brand,
      templateId,
      this.asRecord(existingRecord?.['styleConfig']),
    )
    const groupBinding = this.normalizeGroupBinding(
      this.asRecord(templateBackedData['groupBinding']),
      this.asRecord(existingRecord?.['groupBinding']),
      this.normalizeOptionalString(this.asRecord(existingRecord?.['groupBinding'])?.['boundBy']) || 'system',
    )
    const distributionRules = this.normalizeDistributionRules(
      this.asRecord(templateBackedData['distributionRules']),
      this.asRecord(existingRecord?.['distributionRules']),
      styleConfig,
    )
    const preferences = this.normalizePreferences(
      this.asRecord(templateBackedData['preferences']),
      styleConfig,
      this.asRecord(existingRecord?.['preferences']),
    )
    const schedule = this.normalizeSchedule(
      this.asRecord(templateBackedData['schedule']),
      this.asRecord(existingRecord?.['schedule']),
    )
    const modelOverrides = this.normalizeModelOverrides(
      this.asRecord(templateBackedData['modelOverrides']),
      this.asRecord(existingRecord?.['modelOverrides']),
    )
    const name = this.normalizeOptionalString(templateBackedData['name']) || existingRecord?.['name'] || brand.name

    if (!name) {
      throw new BadRequestException('name is required')
    }

    return {
      orgId: new Types.ObjectId(orgId),
      brandId: brand._id,
      name,
      type: this.normalizeOptionalString(templateBackedData['type']) || existingRecord?.['type'] || 'seeding',
      status: this.normalizeOptionalString(templateBackedData['status']) || existingRecord?.['status'] || PipelineStatus.ACTIVE,
      description: this.normalizeOptionalString(templateBackedData['description']) || existingRecord?.['description'] || '',
      templateId,
      routingConfigId: this.toObjectIdOrNull(this.normalizeOptionalString(templateBackedData['routingConfigId']))
        || existingRecord?.['routingConfigId']
        || null,
      imGroupId: groupBinding.groupId,
      groupBinding,
      styleConfig,
      preferences,
      schedule,
      distributionRules,
      modelOverrides,
      trainingPreferences: existingRecord?.['trainingPreferences'] || [],
      warmUp: existingRecord?.['warmUp'] || {
        required: true,
        status: 'idle',
        lastTriggeredAt: null,
        queuedTaskIds: [],
      },
      totalVideosProduced: existingRecord?.['totalVideosProduced'] || 0,
      totalVideosPublished: existingRecord?.['totalVideosPublished'] || 0,
    }
  }

  private async resolveTemplateResult(
    brand: Brand,
    data: Record<string, any>,
    existingRecord?: Record<string, any> | null,
  ) {
    const templateType = this.normalizeOptionalString(data['templateType'])
    if (!templateType) {
      return null
    }

    return this.templateRegistry.run(templateType, {
      brand: this.buildTemplateBrandContext(brand),
      pipelineName: this.normalizeOptionalString(data['name'])
        || this.normalizeOptionalString(existingRecord?.['name'])
        || brand.name,
      description: this.normalizeOptionalString(data['description'])
        || this.normalizeOptionalString(existingRecord?.['description']),
      params: this.asRecord(data['params']) || {},
    })
  }

  private buildTemplateBrandContext(brand: Brand): TemplateBrandContext {
    return {
      id: brand._id.toString(),
      name: brand.name || 'MediaClaw',
      logo: brand.assets?.logoUrl || '',
      colors: brand.assets?.colors || [],
      fonts: brand.assets?.fonts || [],
      slogans: brand.assets?.slogans || [],
      keywords: brand.assets?.keywords || [],
      referenceVideoUrl: brand.videoStyle?.referenceVideoUrl || '',
      preferredDuration: Math.max(5, brand.videoStyle?.preferredDuration || 15),
      aspectRatio: brand.videoStyle?.aspectRatio || '9:16',
    }
  }

  private applyTemplateDefaults(data: Record<string, any>, templateResult: TemplateResult | null) {
    const source = this.asRecord(data) || {}
    if (!templateResult) {
      return source
    }

    return {
      ...source,
      templateId: this.normalizeOptionalString(source['templateId']) || templateResult.templateId,
      type: this.normalizeOptionalString(source['type']) || templateResult.type,
      name: this.normalizeOptionalString(source['name']) || templateResult.name,
      description: this.normalizeOptionalString(source['description']) || templateResult.description,
      styleConfig: this.mergeStyleConfig(
        this.asRecord(templateResult.styleConfig),
        this.asRecord(source['styleConfig']),
      ),
      distributionRules: this.mergeDistributionRuleConfig(
        this.asRecord(templateResult.distributionRules),
        this.asRecord(source['distributionRules']),
      ),
      preferences: this.mergePreferenceConfig(
        this.asRecord(templateResult.preferences),
        this.asRecord(source['preferences']),
        templateResult,
      ),
      schedule: this.mergeShallowRecord(
        this.asRecord(templateResult.schedule),
        this.asRecord(source['schedule']),
      ),
      modelOverrides: this.mergeShallowRecord(
        this.asRecord(templateResult.modelOverrides),
        this.asRecord(source['modelOverrides']),
      ),
    }
  }

  private mergeStyleConfig(
    templateConfig: Record<string, any> | null,
    sourceConfig: Record<string, any> | null,
  ) {
    const templateBrandAssets = this.asRecord(templateConfig?.['brandAssets'])
    const sourceBrandAssets = this.asRecord(sourceConfig?.['brandAssets'])
    const templateStyleRewrite = this.asRecord(templateConfig?.['styleRewrite'])
    const sourceStyleRewrite = this.asRecord(sourceConfig?.['styleRewrite'])

    return {
      ...(templateConfig || {}),
      ...(sourceConfig || {}),
      platforms: this.mergeStringLists(templateConfig?.['platforms'], sourceConfig?.['platforms']),
      brandAssets: {
        ...(templateBrandAssets || {}),
        ...(sourceBrandAssets || {}),
        colors: this.mergeStringLists(templateBrandAssets?.['colors'], sourceBrandAssets?.['colors']),
        fonts: this.mergeStringLists(templateBrandAssets?.['fonts'], sourceBrandAssets?.['fonts']),
      },
      styleRewrite: {
        ...(templateStyleRewrite || {}),
        ...(sourceStyleRewrite || {}),
        mutationDomains: this.mergeStringLists(
          templateStyleRewrite?.['mutationDomains'],
          sourceStyleRewrite?.['mutationDomains'],
        ),
      },
    }
  }

  private mergeDistributionRuleConfig(
    templateConfig: Record<string, any> | null,
    sourceConfig: Record<string, any> | null,
  ) {
    return {
      ...(templateConfig || {}),
      ...(sourceConfig || {}),
      assignmentIds: this.mergeStringLists(templateConfig?.['assignmentIds'], sourceConfig?.['assignmentIds']),
      preferredPlatforms: this.mergeStringLists(
        templateConfig?.['preferredPlatforms'],
        sourceConfig?.['preferredPlatforms'],
      ),
      preferredCategories: this.mergeStringLists(
        templateConfig?.['preferredCategories'],
        sourceConfig?.['preferredCategories'],
      ),
      templateIds: this.mergeStringLists(templateConfig?.['templateIds'], sourceConfig?.['templateIds']),
      accountTypes: this.mergeStringLists(templateConfig?.['accountTypes'], sourceConfig?.['accountTypes']),
      platformAccountIds: this.mergeStringLists(
        templateConfig?.['platformAccountIds'],
        sourceConfig?.['platformAccountIds'],
      ),
      targets: Array.isArray(sourceConfig?.['targets'])
        ? sourceConfig?.['targets']
        : templateConfig?.['targets'] || [],
    }
  }

  private mergePreferenceConfig(
    templateConfig: Record<string, any> | null,
    sourceConfig: Record<string, any> | null,
    templateResult: TemplateResult,
  ) {
    const templateSubtitlePreferences = this.asRecord(templateConfig?.['subtitlePreferences'])
    const sourceSubtitlePreferences = this.asRecord(sourceConfig?.['subtitlePreferences'])
    const templateRuntime = {
      templateId: templateResult.templateId,
      ...templateResult.runtime,
    }

    return {
      ...(templateConfig || {}),
      ...(sourceConfig || {}),
      preferredStyles: this.mergeStringLists(templateConfig?.['preferredStyles'], sourceConfig?.['preferredStyles']),
      avoidStyles: this.mergeStringLists(templateConfig?.['avoidStyles'], sourceConfig?.['avoidStyles']),
      subtitlePreferences: {
        ...(templateSubtitlePreferences || {}),
        ...(sourceSubtitlePreferences || {}),
        templateRuntime: {
          ...this.asRecord(templateSubtitlePreferences?.['templateRuntime']),
          ...templateRuntime,
          ...this.asRecord(sourceSubtitlePreferences?.['templateRuntime']),
        },
      },
      remixInsights: {
        ...(this.asRecord(templateConfig?.['remixInsights']) || {}),
        ...(this.asRecord(sourceConfig?.['remixInsights']) || {}),
      },
    }
  }

  private mergeShallowRecord(
    templateConfig: Record<string, any> | null,
    sourceConfig: Record<string, any> | null,
  ) {
    return {
      ...(templateConfig || {}),
      ...(sourceConfig || {}),
    }
  }

  private mergeStringLists(templateValues: unknown, sourceValues: unknown) {
    return this.normalizeStringList([
      ...(Array.isArray(templateValues) ? templateValues : []),
      ...(Array.isArray(sourceValues) ? sourceValues : []),
    ])
  }

  private normalizeStyleConfig(
    incoming: Record<string, any> | null,
    brand: Brand,
    templateId: string,
    existing?: Record<string, any> | null,
  ) {
    const source = incoming || {}
    const previous = existing || {}
    const brandAssets = brand.assets || {}
    const brandVideoStyle = brand.videoStyle || {}
    const styleRewriteSource = this.asRecord(source['styleRewrite'])
    const previousStyleRewrite = this.asRecord(previous['styleRewrite'])
    const defaultStyleRewrite = this.buildDefaultStyleRewriteConfig(templateId)

    return {
      duration: this.normalizePositiveNumber(
        source['duration'],
        this.normalizePositiveNumber(previous['duration'], brandVideoStyle.preferredDuration || 15),
      ),
      aspectRatio: this.normalizeOptionalString(source['aspectRatio'])
        || this.normalizeOptionalString(previous['aspectRatio'])
        || brandVideoStyle.aspectRatio
        || '9:16',
      tone: this.normalizeOptionalString(source['tone'])
        || this.normalizeOptionalString(previous['tone'])
        || '',
      visualStyle: this.normalizeOptionalString(source['visualStyle'])
        || this.normalizeOptionalString(previous['visualStyle'])
        || '',
      platforms: this.normalizeStringList(
        Array.isArray(source['platforms']) ? source['platforms'] : previous['platforms'],
      ),
      brandAssets: {
        logo: this.normalizeOptionalString(this.asRecord(source['brandAssets'])?.['logo'])
          || this.normalizeOptionalString(this.asRecord(previous['brandAssets'])?.['logo'])
          || brandAssets.logoUrl
          || '',
        colors: this.normalizeStringList(
          Array.isArray(this.asRecord(source['brandAssets'])?.['colors'])
            ? this.asRecord(source['brandAssets'])?.['colors']
            : this.asRecord(previous['brandAssets'])?.['colors'] || brandAssets.colors || [],
        ),
        fonts: this.normalizeStringList(
          Array.isArray(this.asRecord(source['brandAssets'])?.['fonts'])
            ? this.asRecord(source['brandAssets'])?.['fonts']
            : this.asRecord(previous['brandAssets'])?.['fonts'] || brandAssets.fonts || [],
        ),
      },
      styleRewrite: {
        enabled: this.resolveBooleanValue(
          [
            styleRewriteSource?.['enabled'],
            previousStyleRewrite?.['enabled'],
          ],
          defaultStyleRewrite.enabled,
        ),
        scope: this.normalizeStyleRewriteScope(
          this.normalizeOptionalString(styleRewriteSource?.['scope'])
          || this.normalizeOptionalString(previousStyleRewrite?.['scope'])
          || defaultStyleRewrite.scope,
        ),
        preserveComposition: this.resolveBooleanValue(
          [
            styleRewriteSource?.['preserveComposition'],
            previousStyleRewrite?.['preserveComposition'],
          ],
          true,
        ),
        preserveProductPlacement: this.resolveBooleanValue(
          [
            styleRewriteSource?.['preserveProductPlacement'],
            previousStyleRewrite?.['preserveProductPlacement'],
          ],
          true,
        ),
        mutationDomains: this.normalizeStringList(
          Array.isArray(styleRewriteSource?.['mutationDomains'])
            ? styleRewriteSource?.['mutationDomains']
            : Array.isArray(previousStyleRewrite?.['mutationDomains'])
              ? previousStyleRewrite?.['mutationDomains']
              : defaultStyleRewrite.mutationDomains,
        ),
      },
    }
  }

  private normalizePreferences(
    incoming: Record<string, any> | null,
    styleConfig: Record<string, any> | null,
    existing?: Record<string, any> | null,
  ) {
    const source = incoming || {}
    const previous = existing || {}
    const feedbackLog = Array.isArray(source['feedbackLog'])
      ? source['feedbackLog']
      : Array.isArray(previous['feedbackLog'])
        ? previous['feedbackLog']
        : []

    return {
      preferredStyles: this.normalizeStringList(
        Array.isArray(source['preferredStyles']) ? source['preferredStyles'] : previous['preferredStyles'],
      ),
      avoidStyles: this.normalizeStringList(
        Array.isArray(source['avoidStyles']) ? source['avoidStyles'] : previous['avoidStyles'],
      ),
      preferredDuration: this.normalizePositiveNumber(
        source['preferredDuration'],
        this.normalizePositiveNumber(previous['preferredDuration'], Number(styleConfig?.['duration'] || 15)),
      ),
      aspectRatio: this.normalizeOptionalString(source['aspectRatio'])
        || this.normalizeOptionalString(previous['aspectRatio'])
        || this.normalizeOptionalString(styleConfig?.['aspectRatio'])
        || '9:16',
      subtitlePreferences: {
        ...(this.asRecord(previous['subtitlePreferences']) || {}),
        ...(this.asRecord(source['subtitlePreferences']) || {}),
      },
      remixInsights: {
        ...(this.asRecord(previous['remixInsights']) || {}),
        ...(this.asRecord(source['remixInsights']) || {}),
      },
      feedbackLog,
      preferenceLearning: {
        ...(this.asRecord(previous['preferenceLearning']) || {}),
        ...(this.asRecord(source['preferenceLearning']) || {}),
      },
      lastFeedbackAt: source['lastFeedbackAt'] || previous['lastFeedbackAt'] || null,
      feedbackCount: this.normalizePositiveNumber(source['feedbackCount'], Number(previous['feedbackCount'] || 0)),
    }
  }

  private normalizeSchedule(incoming?: Record<string, any> | null, existing?: Record<string, any> | null) {
    const source = incoming || {}
    const previous = existing || {}

    return {
      enabled: this.normalizeBoolean(source['enabled'], Boolean(previous['enabled'])),
      cron: this.normalizeOptionalString(source['cron'])
        || this.normalizeOptionalString(previous['cron'])
        || '0 9 * * 1-5',
      videosPerRun: this.normalizePositiveNumber(source['videosPerRun'], Number(previous['videosPerRun'] || 1)),
      timezone: this.normalizeOptionalString(source['timezone'])
        || this.normalizeOptionalString(previous['timezone'])
        || 'Asia/Shanghai',
    }
  }

  private normalizeDistributionRules(
    incoming?: Record<string, any> | null,
    existing?: Record<string, any> | null,
    styleConfig?: Record<string, any> | null,
  ) {
    const source = incoming || {}
    const previous = existing || {}
    const targets = this.normalizeDistributionTargets(
      Array.isArray(source['targets']) ? source['targets'] : previous['targets'],
    )
    const targetAssignmentIds = targets
      .map(target => target.assignmentId)
      .filter(Boolean)
    const targetPlatforms = targets.flatMap(target => target.targetPlatforms || [])
    const targetPlatformAccountIds = targets
      .map(target => this.normalizeOptionalString(this.asRecord(target.outputConfig)?.['platformAccountId']))
      .filter(Boolean)

    return {
      assignmentIds: this.normalizeStringList([
        ...(Array.isArray(previous['assignmentIds']) ? previous['assignmentIds'] : []),
        ...(Array.isArray(source['assignmentIds']) ? source['assignmentIds'] : []),
        ...targetAssignmentIds,
      ]),
      preferredPlatforms: this.normalizeStringList([
        ...(Array.isArray(previous['preferredPlatforms']) ? previous['preferredPlatforms'] : []),
        ...(Array.isArray(source['preferredPlatforms']) ? source['preferredPlatforms'] : []),
        ...targetPlatforms,
        ...(Array.isArray(styleConfig?.['platforms']) ? styleConfig?.['platforms'] : []),
      ]),
      preferredCategories: this.normalizeStringList(
        Array.isArray(source['preferredCategories']) ? source['preferredCategories'] : previous['preferredCategories'],
      ),
      templateIds: this.normalizeStringList([
        ...(Array.isArray(previous['templateIds']) ? previous['templateIds'] : []),
        ...(Array.isArray(source['templateIds']) ? source['templateIds'] : []),
      ]),
      accountTypes: this.normalizeStringList([
        ...(Array.isArray(previous['accountTypes']) ? previous['accountTypes'] : []),
        ...(Array.isArray(source['accountTypes']) ? source['accountTypes'] : []),
      ]),
      platformAccountIds: this.normalizeStringList([
        ...(Array.isArray(previous['platformAccountIds']) ? previous['platformAccountIds'] : []),
        ...(Array.isArray(source['platformAccountIds']) ? source['platformAccountIds'] : []),
        ...targetPlatformAccountIds,
      ]),
      strategy: this.normalizeOptionalString(source['strategy'])
        || this.normalizeOptionalString(previous['strategy'])
        || 'round-robin',
      targets,
    }
  }

  private normalizeDistributionTargets(values: unknown) {
    return (Array.isArray(values) ? values : [])
      .map((target) => {
        const record = this.asRecord(target)
        return {
          employeeName: this.normalizeOptionalString(record?.['employeeName']) || '',
          assignmentId: this.normalizeOptionalString(record?.['assignmentId']) || '',
          imChannel: this.normalizeOptionalString(record?.['imChannel']) || '',
          imUserId: this.normalizeOptionalString(record?.['imUserId']) || '',
          targetPlatforms: this.normalizeStringList(record?.['targetPlatforms']),
          preferredTimeSlots: this.normalizeStringList(record?.['preferredTimeSlots']),
          outputConfig: this.asRecord(record?.['outputConfig']) || {},
        }
      })
      .filter(target => target.employeeName || target.assignmentId || target.imUserId)
  }

  private normalizeModelOverrides(incoming?: Record<string, any> | null, existing?: Record<string, any> | null) {
    const source = incoming || {}
    const previous = existing || {}

    return {
      copy: this.normalizeOptionalString(source['copy']) || this.normalizeOptionalString(previous['copy']) || '',
      frameEdit: this.normalizeOptionalString(source['frameEdit']) || this.normalizeOptionalString(previous['frameEdit']) || '',
      videoGen: this.normalizeOptionalString(source['videoGen']) || this.normalizeOptionalString(previous['videoGen']) || '',
    }
  }

  private normalizeGroupBinding(
    incoming?: Record<string, any> | null,
    existing?: Record<string, any> | null,
    boundBy?: string,
  ) {
    const source = incoming || {}
    const previous = existing || {}
    const hasIncomingBinding = Boolean(
      this.normalizeOptionalString(source['groupId'])
      || this.normalizeOptionalString(source['channel'])
      || this.normalizeOptionalString(source['groupName']),
    )
    const groupId = this.normalizeOptionalString(source['groupId'])
      || this.normalizeOptionalString(previous['groupId'])
      || ''
    const channel = this.normalizeOptionalString(source['channel'])
      || this.normalizeOptionalString(previous['channel'])
      || ''

    return {
      channel,
      groupId,
      groupName: this.normalizeOptionalString(source['groupName'])
        || this.normalizeOptionalString(previous['groupName'])
        || '',
      boundAt: groupId && channel && hasIncomingBinding
        ? new Date()
        : previous['boundAt'] || null,
      boundBy: groupId && channel && hasIncomingBinding
        ? this.normalizeOptionalString(boundBy) || this.normalizeOptionalString(source['boundBy']) || this.normalizeOptionalString(previous['boundBy']) || 'system'
        : this.normalizeOptionalString(previous['boundBy']) || '',
    }
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
      status: { $ne: PipelineStatus.ARCHIVED },
    }
  }

  private async findOwnedPipeline(orgId: string, id: string) {
    return this.pipelineModel.findOne(this.buildOwnedQuery(orgId, id)).exec()
  }

  private async requireOwnedPipeline(orgId: string, id: string) {
    const pipeline = await this.findOwnedPipeline(orgId, id)
    if (!pipeline) {
      throw new NotFoundException('Pipeline not found')
    }

    return pipeline
  }

  private async getOwnedBrandOrFail(orgId: string, brandId: string) {
    if (!Types.ObjectId.isValid(brandId)) {
      throw new BadRequestException('brandId is invalid')
    }

    const brand = await this.brandModel.findOne({
      _id: new Types.ObjectId(brandId),
      orgId: new Types.ObjectId(orgId),
      isActive: true,
    }).exec()

    if (!brand) {
      throw new NotFoundException('Brand not found')
    }

    return brand
  }

  private async loadBrandProfile(brandId: string | null): Promise<PipelineBrandProfile> {
    if (!brandId || !Types.ObjectId.isValid(brandId)) {
      return this.buildDefaultBrandProfile()
    }

    const brand = await this.brandModel.findById(new Types.ObjectId(brandId)).exec()
    if (!brand) {
      return this.buildDefaultBrandProfile()
    }

    return {
      id: brand._id.toString(),
      name: brand.name || 'MediaClaw',
      colors: brand.assets?.colors || [],
      fonts: brand.assets?.fonts || [],
      slogans: brand.assets?.slogans || [],
      keywords: brand.assets?.keywords || [],
      prohibitedWords: brand.assets?.prohibitedWords || [],
      preferredDuration: Math.max(5, brand.videoStyle?.preferredDuration || 15),
      aspectRatio: brand.videoStyle?.aspectRatio || '9:16',
      subtitleStyle: brand.videoStyle?.subtitleStyle || {},
      referenceVideoUrl: brand.videoStyle?.referenceVideoUrl || '',
    }
  }

  private async loadPipelineDocument(pipelineId: string | null) {
    if (!pipelineId || !Types.ObjectId.isValid(pipelineId)) {
      return null
    }

    return this.pipelineModel.findById(new Types.ObjectId(pipelineId)).exec()
  }

  private buildDefaultBrandProfile(): PipelineBrandProfile {
    return {
      id: null,
      name: 'MediaClaw',
      colors: [],
      fonts: [],
      slogans: [],
      keywords: [],
      prohibitedWords: [],
      preferredDuration: 15,
      aspectRatio: '9:16',
      subtitleStyle: {},
      referenceVideoUrl: '',
    }
  }

  private resolveTemplateId(metadata: Record<string, any>, pipeline?: Pipeline | null) {
    const productionBatch = this.asRecord(metadata['productionBatch'])

    return this.normalizeOptionalString(metadata['templateId'])
      || this.normalizeOptionalString(productionBatch?.['templateId'])
      || this.normalizeOptionalString(pipeline?.templateId)
      || ''
  }

  private resolveStyleRewriteConfig(
    metadata: Record<string, any>,
    pipeline: Pipeline | null,
    templateId: string,
  ): PipelineStyleRewriteConfig {
    const productionBatch = this.asRecord(metadata['productionBatch'])
    const styleOverrides = this.asRecord(productionBatch?.['styleOverrides'])
    const styleConfig = this.asRecord(pipeline?.styleConfig)
    const styleRewrite = this.asRecord(styleConfig?.['styleRewrite'])
    const subtitlePreferences = this.asRecord(this.asRecord(pipeline?.preferences)?.['subtitlePreferences'])
    const defaults = this.buildDefaultStyleRewriteConfig(templateId)
    const enabled = this.resolveBooleanValue(
      [
        metadata['styleRewrite'],
        metadata['styleRewriteEnabled'],
        styleOverrides?.['styleRewrite'],
        styleOverrides?.['styleRewriteEnabled'],
        styleRewrite?.['enabled'],
        subtitlePreferences?.['styleRewrite'],
        subtitlePreferences?.['styleRewriteEnabled'],
      ],
      defaults.enabled,
    )
    const scope = this.normalizeStyleRewriteScope(
      this.normalizeOptionalString(metadata['styleRewriteScope'])
      || this.normalizeOptionalString(styleOverrides?.['styleRewriteScope'])
      || this.normalizeOptionalString(styleRewrite?.['scope'])
      || defaults.scope,
    )

    return {
      enabled,
      scope,
      preserveComposition: this.resolveBooleanValue(
        [styleRewrite?.['preserveComposition']],
        true,
      ),
      preserveProductPlacement: this.resolveBooleanValue(
        [styleRewrite?.['preserveProductPlacement']],
        true,
      ),
      mutationDomains: this.normalizeStringList(
        Array.isArray(styleRewrite?.['mutationDomains'])
          ? styleRewrite?.['mutationDomains']
          : defaults.mutationDomains,
      ),
    }
  }

  private buildDefaultStyleRewriteConfig(templateId: string): PipelineStyleRewriteConfig {
    const normalizedTemplateId = this.normalizeOptionalString(templateId)
    const enabled = normalizedTemplateId === 'b7-ai-live' || normalizedTemplateId === 'b9-product-showcase'
    const scope = normalizedTemplateId === 'b9-product-showcase' ? 'per_scene' : 'shared'

    return {
      enabled,
      scope,
      preserveComposition: true,
      preserveProductPlacement: true,
      mutationDomains: [...this.defaultStyleRewriteMutationDomains],
    }
  }

  private async resolveModels(orgId: string | null, pipelineId: string | null): Promise<PipelineResolvedModels> {
    if (!orgId || !Types.ObjectId.isValid(orgId)) {
      return {
        copy: this.createFallbackModel('copy', 'deepseek-v3', 'deepseek', 'deepseek-chat'),
        frameEdit: this.createFallbackModel('frameEdit', 'gemini-2.5-flash-image', 'vce', 'gemini-2.5-flash-image'),
        videoGen: this.createFallbackModel('videoGen', 'kling-v3-omni', 'kling', 'kling-v3-omni'),
      }
    }

    const [copy, frameEdit, videoGen] = await Promise.all([
      this.modelResolverService.resolveCapability(orgId, 'copy', pipelineId),
      this.modelResolverService.resolveCapability(orgId, 'frameEdit', pipelineId),
      this.modelResolverService.resolveCapability(orgId, 'videoGen', pipelineId),
    ])

    return {
      copy: {
        capability: 'copy',
        id: copy.id,
        label: copy.label,
        provider: copy.provider,
        runtimeModel: copy.runtimeModel,
        source: copy.source,
      },
      frameEdit: {
        capability: 'frameEdit',
        id: frameEdit.id,
        label: frameEdit.label,
        provider: frameEdit.provider,
        runtimeModel: frameEdit.runtimeModel,
        source: frameEdit.source,
      },
      videoGen: {
        capability: 'videoGen',
        id: videoGen.id,
        label: videoGen.label,
        provider: videoGen.provider,
        runtimeModel: videoGen.runtimeModel,
        source: videoGen.source,
      },
    }
  }

  private createFallbackModel(
    capability: 'copy' | 'frameEdit' | 'videoGen',
    id: string,
    provider: string,
    runtimeModel: string,
  ) {
    return {
      capability,
      id,
      label: id,
      provider,
      runtimeModel,
      source: 'default' as const,
    }
  }

  private resolveTargetDuration(
    metadata: Record<string, any>,
    brandPreferredDuration: number,
    pipelinePreferredDuration?: number,
  ) {
    const explicitDuration = this.readNumber(metadata, 'targetDurationSeconds')
      || this.readNumber(metadata, 'durationSeconds')
      || this.readNumber(metadata, 'targetDuration')

    return Math.max(
      6,
      Math.min(
        explicitDuration || pipelinePreferredDuration || brandPreferredDuration || 15,
        60,
      ),
    )
  }

  private resolveAspectRatio(
    metadata: Record<string, any>,
    brandAspectRatio: string,
    pipelineAspectRatio?: string,
  ) {
    return this.readString(metadata, 'aspectRatio') || pipelineAspectRatio || brandAspectRatio || '9:16'
  }

  private buildSubtitleVariants(task: VideoTask, brand: PipelineBrandProfile, targetDurationSeconds: number): PipelineSubtitleVariant[] {
    const subtitleSeed = this.readString(task.metadata, 'subtitleText')
    const hookText = this.readString(task.metadata, 'hookText') || subtitleSeed || `${brand.name} 视频改编完成`
    const productText = this.readString(task.metadata, 'productText')
      || brand.keywords.slice(0, 2).join(' ')
      || `${brand.name} 品牌信息已融合`
    const ctaText = this.readString(task.metadata, 'ctaText')
      || brand.slogans[0]
      || `立即了解 ${brand.name}`
    const segmentDuration = targetDurationSeconds / 3

    return [
      { text: hookText, startSeconds: 0, endSeconds: segmentDuration },
      { text: productText, startSeconds: segmentDuration, endSeconds: segmentDuration * 2 },
      { text: ctaText, startSeconds: segmentDuration * 2, endSeconds: targetDurationSeconds },
    ]
  }

  private buildCopySubtitleVariants(copy: GeneratedCopy, brand: PipelineBrandProfile, targetDurationSeconds: number) {
    const segmentDuration = targetDurationSeconds / 3
    const commentGuide = copy.commentGuides[0]
      || copy.commentGuide.split('\n').map(item => item.trim()).find(Boolean)
      || brand.slogans[0]
      || `评论区获取 ${brand.name} 完整方案`

    return [
      {
        text: copy.title.trim() || `${brand.name} 爆款改编完成`,
        startSeconds: 0,
        endSeconds: segmentDuration,
      },
      {
        text: copy.subtitle.trim() || `${brand.name} 品牌亮点已注入`,
        startSeconds: segmentDuration,
        endSeconds: segmentDuration * 2,
      },
      {
        text: commentGuide,
        startSeconds: segmentDuration * 2,
        endSeconds: targetDurationSeconds,
      },
    ]
  }

  private async persistOutput(taskId: string, inputVideoPath: string) {
    return this.persistArtifact(taskId, inputVideoPath, 'mp4')
  }

  private async persistArtifact(
    taskId: string,
    inputPath: string,
    extension: string,
    suffix = '',
  ) {
    const outputDir = resolve(process.cwd(), 'tmp', 'mediaclaw-output')
    await ensureDirectory(outputDir)
    const normalizedExtension = extension.replace(/^\./, '')
    const normalizedSuffix = this.normalizeOptionalString(suffix)
    const outputPath = join(
      outputDir,
      normalizedSuffix
        ? `${taskId}-${normalizedSuffix}.${normalizedExtension}`
        : `${taskId}.${normalizedExtension}`,
    )
    await copyFile(inputPath, outputPath)
    return buildPublicFileUrl(outputPath)
  }

  private async generateVoiceoverArtifact(
    task: VideoTask,
    context: PipelineJobContext,
    copy: GeneratedCopy,
  ) {
    if (!this.ttsService?.isConfigured()) {
      return null
    }

    const text = this.buildVoiceoverText(copy)
    if (!text) {
      return null
    }

    try {
      const voiceover = await this.ttsService.generateVoiceover({
        text,
        voiceId: this.resolveVoiceIdFromTask(task),
        speed: this.resolveVoiceSpeedFromTask(task),
      })
      const voiceoverPath = join(context.workspaceDir, 'voiceover.mp3')
      await writeFile(voiceoverPath, voiceover.buffer)

      return {
        voiceoverPath,
        voiceoverUrl: await this.persistArtifact(task._id.toString(), voiceoverPath, 'mp3', 'voiceover'),
        voiceoverMeta: {
          provider: voiceover.provider,
          voiceId: voiceover.voiceId,
          format: voiceover.format,
          sampleRate: voiceover.sampleRate,
          durationMs: voiceover.durationMs,
          text,
        },
      }
    }
    catch (error) {
      this.logger.warn(
        `Voiceover generation skipped for ${task._id.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }

  private async mixVoiceoverTrack(
    inputVideoPath: string,
    voiceoverPath: string,
    outputPath: string,
    mixSourceAudio: boolean,
  ) {
    const args = mixSourceAudio
      ? [
          '-y',
          '-i',
          inputVideoPath,
          '-i',
          voiceoverPath,
          '-filter_complex',
          '[0:a][1:a]amix=inputs=2:duration=first:weights=0.25 1[aout]',
          '-map',
          '0:v',
          '-map',
          '[aout]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-shortest',
          outputPath,
        ]
      : [
          '-y',
          '-i',
          inputVideoPath,
          '-i',
          voiceoverPath,
          '-map',
          '0:v',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-shortest',
          outputPath,
        ]

    await runCommand('ffmpeg', args, { timeoutMs: 180_000 })
    return outputPath
  }

  private requirePath(value: string | undefined, field: string) {
    if (!value) {
      throw new Error(`${field} is required`)
    }
    return value
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : null
  }

  private normalizeOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : ''
  }

  private buildVoiceoverText(copy: GeneratedCopy) {
    const segments = [
      this.normalizeOptionalString(copy.title),
      this.normalizeOptionalString(copy.subtitle),
      this.normalizeOptionalString(copy.description),
      ...this.normalizeStringList(copy.commentGuides).slice(0, 1),
    ]

    return [...new Set(segments)]
      .filter(Boolean)
      .join('。')
      .replace(/[#@]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[。.!?]{2,}/g, '。')
      .trim()
      .slice(0, 600)
  }

  private resolveVoiceIdFromTask(task: VideoTask) {
    const metadata = this.asRecord(task.metadata) || {}
    const voiceover = this.asRecord(metadata['voiceover']) || {}
    const candidates = [
      this.normalizeOptionalString(voiceover['voiceId']),
      this.normalizeOptionalString(metadata['voiceId']),
      this.normalizeOptionalString(metadata['voiceoverVoiceId']),
    ]

    const resolved = candidates.find(candidate => (MINIMAX_TTS_VOICE_IDS as readonly string[]).includes(candidate))
    return resolved || MINIMAX_TTS_VOICE_IDS[0]
  }

  private resolveVoiceSpeedFromTask(task: VideoTask) {
    const metadata = this.asRecord(task.metadata) || {}
    const voiceover = this.asRecord(metadata['voiceover']) || {}
    const candidates = [
      voiceover['speed'],
      metadata['voiceoverSpeed'],
      metadata['speechSpeed'],
    ]

    for (const candidate of candidates) {
      const normalized = Number(candidate)
      if (Number.isFinite(normalized)) {
        return normalized
      }
    }

    return 1
  }

  private normalizeStringList(value: unknown) {
    return [...new Set(
      (Array.isArray(value) ? value : [])
        .map(item => this.normalizeOptionalString(item))
        .filter(Boolean),
    )]
  }

  private normalizePositiveNumber(value: unknown, fallback: number) {
    const normalized = Number(value)
    return Number.isFinite(normalized) && normalized > 0
      ? normalized
      : fallback
  }

  private normalizeBoolean(value: unknown, fallback: boolean) {
    return typeof value === 'boolean' ? value : fallback
  }

  private normalizeStyleRewriteScope(value: string) {
    return value === 'per_scene' ? 'per_scene' as const : 'shared' as const
  }

  private resolveBooleanValue(values: unknown[], fallback: boolean) {
    for (const value of values) {
      if (typeof value === 'boolean') {
        return value
      }

      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true') {
          return true
        }
        if (normalized === 'false') {
          return false
        }
      }
    }

    return fallback
  }

  private toObjectIdOrNull(value: string) {
    if (!value) {
      return null
    }

    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException('routingConfigId is invalid')
    }

    return new Types.ObjectId(value)
  }

  private readString(metadata: Record<string, any>, key: string) {
    const value = metadata[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  private readNumber(metadata: Record<string, any>, key: string) {
    const value = metadata[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  private readBoolean(metadata: Record<string, any>, key: string, defaultValue: boolean) {
    const value = metadata[key]
    return typeof value === 'boolean' ? value : defaultValue
  }
}
