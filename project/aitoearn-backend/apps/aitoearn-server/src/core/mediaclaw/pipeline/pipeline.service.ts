import type { GeneratedCopy } from '../copy/copy.service'
import { copyFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand, Pipeline, PipelineStatus, VideoTask } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { ModelResolverService } from '../model-resolver/model-resolver.service'
import { BrandEditService } from './brand-edit.service'
import { DedupService } from './dedup.service'
import { DeepSynthesisMarkerService } from './deep-synthesis-marker.service'
import { FrameExtractService } from './frame-extract.service'
import {
  PipelineBrandProfile,
  PipelineJobContext,
  PipelineQualityReport,
  PipelineResolvedModels,
  PipelineSubtitleVariant,
} from './pipeline.types'
import { buildPublicFileUrl, ensureDirectory, resolveRenderSize } from './pipeline.utils'
import { QualityCheckService } from './quality-check.service'
import { SubtitleService } from './subtitle.service'
import { VideoGenService } from './video-gen.service'

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name)

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
  ) {}

  async create(orgId: string, brandId: string, data: Record<string, any>) {
    const brand = await this.getOwnedBrandOrFail(orgId, brandId)
    const payload = this.buildPipelinePayload(orgId, brand, data)
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
      this.buildPipelinePayload(orgId, brand, data, pipeline),
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
      sourceVideoPath,
      sourceMetadata,
      targetDurationSeconds,
      renderWidth: renderSize.width,
      renderHeight: renderSize.height,
      brand,
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

    const outputVideoUrl = await this.persistOutput(task._id.toString(), finalVideoPath)

    return {
      ...context,
      subtitles,
      subtitledVideoPath: subtitleResult.outputPath,
      finalVideoPath,
      outputVideoUrl,
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

  private buildPipelinePayload(
    orgId: string,
    brand: Brand,
    data: Record<string, any>,
    existing?: Pipeline | null,
  ) {
    const existingRecord = existing ? ((existing as any)?.toObject?.() || (existing as Record<string, any>)) : null
    const styleConfig = this.normalizeStyleConfig(
      this.asRecord(data['styleConfig']),
      brand,
      this.asRecord(existingRecord?.['styleConfig']),
    )
    const groupBinding = this.normalizeGroupBinding(
      this.asRecord(data['groupBinding']),
      this.asRecord(existingRecord?.['groupBinding']),
      this.normalizeOptionalString(this.asRecord(existingRecord?.['groupBinding'])?.['boundBy']) || 'system',
    )
    const distributionRules = this.normalizeDistributionRules(
      this.asRecord(data['distributionRules']),
      this.asRecord(existingRecord?.['distributionRules']),
      styleConfig,
    )
    const preferences = this.normalizePreferences(
      this.asRecord(data['preferences']),
      styleConfig,
      this.asRecord(existingRecord?.['preferences']),
    )
    const schedule = this.normalizeSchedule(
      this.asRecord(data['schedule']),
      this.asRecord(existingRecord?.['schedule']),
    )
    const modelOverrides = this.normalizeModelOverrides(
      this.asRecord(data['modelOverrides']),
      this.asRecord(existingRecord?.['modelOverrides']),
    )
    const name = this.normalizeOptionalString(data['name']) || existingRecord?.['name'] || brand.name

    if (!name) {
      throw new BadRequestException('name is required')
    }

    return {
      orgId: new Types.ObjectId(orgId),
      brandId: brand._id,
      name,
      type: this.normalizeOptionalString(data['type']) || existingRecord?.['type'] || 'seeding',
      status: this.normalizeOptionalString(data['status']) || existingRecord?.['status'] || PipelineStatus.ACTIVE,
      description: this.normalizeOptionalString(data['description']) || existingRecord?.['description'] || '',
      templateId: this.normalizeOptionalString(data['templateId']) || existingRecord?.['templateId'] || '',
      routingConfigId: this.toObjectIdOrNull(this.normalizeOptionalString(data['routingConfigId']))
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

  private normalizeStyleConfig(
    incoming: Record<string, any> | null,
    brand: Brand,
    existing?: Record<string, any> | null,
  ) {
    const source = incoming || {}
    const previous = existing || {}
    const brandAssets = brand.assets || {}
    const brandVideoStyle = brand.videoStyle || {}

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
    }
  }

  private normalizePreferences(
    incoming: Record<string, any> | null,
    styleConfig: Record<string, any> | null,
    existing?: Record<string, any> | null,
  ) {
    const source = incoming || {}
    const previous = existing || {}

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
    const outputDir = resolve(process.cwd(), 'tmp', 'mediaclaw-output')
    await ensureDirectory(outputDir)
    const outputPath = join(outputDir, `${taskId}.mp4`)
    await copyFile(inputVideoPath, outputPath)
    return buildPublicFileUrl(outputPath)
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
