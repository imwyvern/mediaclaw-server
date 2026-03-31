import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand, Pipeline, PipelineStatus, VideoTask } from '@yikart/mongodb'
import { copyFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Model, Types } from 'mongoose'
import { BrandEditService } from './brand-edit.service'
import { DedupService } from './dedup.service'
import { FrameExtractService } from './frame-extract.service'
import {
  PipelineBrandProfile,
  PipelineJobContext,
  PipelineQualityReport,
  PipelineSubtitleVariant,
} from './pipeline.types'
import { QualityCheckService } from './quality-check.service'
import { SubtitleService } from './subtitle.service'
import { VideoGenService } from './video-gen.service'
import { buildPublicFileUrl, ensureDirectory, resolveRenderSize } from './pipeline.utils'

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name)

  constructor(
    @InjectModel(Pipeline.name) private readonly pipelineModel: Model<Pipeline>,
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    private readonly frameExtractService: FrameExtractService,
    private readonly brandEditService: BrandEditService,
    private readonly videoGenService: VideoGenService,
    private readonly subtitleService: SubtitleService,
    private readonly dedupService: DedupService,
    private readonly qualityCheckService: QualityCheckService,
  ) {}

  async create(orgId: string, brandId: string, data: Partial<Pipeline>) {
    return this.pipelineModel.create({
      ...data,
      orgId: new Types.ObjectId(orgId),
      brandId: new Types.ObjectId(brandId),
      status: PipelineStatus.ACTIVE,
    })
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

  async update(orgId: string, id: string, data: Partial<Pipeline>) {
    await this.findOwnedPipeline(orgId, id)
    return this.pipelineModel.findOneAndUpdate(this.buildOwnedQuery(orgId, id), data, { new: true }).exec()
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
    await this.findOwnedPipeline(orgId, id)
    return this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      { $set: { preferences } },
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
    const targetDurationSeconds = this.resolveTargetDuration(task.metadata, brand.preferredDuration, pipeline?.preferences?.preferredDuration)
    const aspectRatio = this.resolveAspectRatio(task.metadata, brand.aspectRatio, pipeline?.preferences?.aspectRatio)
    const resolution = this.readString(task.metadata, 'resolution')
    const renderSize = resolveRenderSize(aspectRatio, resolution)
    const frameArtifacts = await this.frameExtractService.extractKeyFrames(
      sourceVideoPath,
      workspaceDir,
      sourceMetadata.durationSeconds || targetDurationSeconds,
    )

    return {
      taskId: task._id.toString(),
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
    }
  }

  async editFrames(context: PipelineJobContext): Promise<PipelineJobContext> {
    const frameArtifacts = await this.brandEditService.applyBranding(context)
    return {
      ...context,
      frameArtifacts,
    }
  }

  async renderVideo(task: VideoTask, context: PipelineJobContext): Promise<PipelineJobContext> {
    const segmentVideoPaths = await this.videoGenService.generateSegments(context)
    const composedVideoPath = await this.videoGenService.composeSegments(context, segmentVideoPaths)
    const subtitledVideoPath = await this.subtitleService.renderSubtitles({
      ...context,
      segmentVideoPaths,
      composedVideoPath,
    })
    const finalVideoPath = join(context.workspaceDir, 'final.mp4')

    await this.dedupService.applyVideoPostProcess({
      inputVideoPath: subtitledVideoPath,
      outputVideoPath: finalVideoPath,
      strategy: context.dedupStrategy,
      preserveAudio: context.preserveSourceAudio,
    })

    const outputVideoUrl = await this.persistOutput(task._id.toString(), finalVideoPath)

    return {
      ...context,
      segmentVideoPaths,
      composedVideoPath,
      subtitledVideoPath,
      finalVideoPath,
      outputVideoUrl,
    }
  }

  async runQualityCheck(context: PipelineJobContext): Promise<PipelineQualityReport> {
    const finalVideoPath = this.requirePath(context.finalVideoPath, 'finalVideoPath')
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

  private async persistOutput(taskId: string, finalVideoPath: string) {
    const outputDir = resolve(process.cwd(), 'tmp', 'mediaclaw-output')
    await ensureDirectory(outputDir)
    const outputPath = join(outputDir, `${taskId}.mp4`)
    await copyFile(finalVideoPath, outputPath)
    return buildPublicFileUrl(outputPath)
  }

  private requirePath(value: string | undefined, field: string) {
    if (!value) {
      throw new Error(`${field} is required`)
    }
    return value
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
