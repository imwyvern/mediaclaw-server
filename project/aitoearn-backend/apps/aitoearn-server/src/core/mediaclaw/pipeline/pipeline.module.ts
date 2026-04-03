import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Brand, BrandSchema, Pipeline, PipelineSchema, VideoTask, VideoTaskSchema } from '@yikart/mongodb'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { SettingsModule } from '../settings/settings.module'
import { VideoWorkerQueueModule } from '../worker/video-worker-queue.module'
import { BrandEditService } from './brand-edit.service'
import { DeepSynthesisMarkerService } from './deep-synthesis-marker.service'
import { DedupService } from './dedup.service'
import { FrameExtractService } from './frame-extract.service'
import { PipelineController } from './pipeline.controller'
import { PipelineService } from './pipeline.service'
import { PromptOptimizerService } from './prompt-optimizer.service'
import { QualityCheckService } from './quality-check.service'
import { SubtitleService } from './subtitle.service'
import { VideoGenService } from './video-gen.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Pipeline.name, schema: PipelineSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    MediaclawConfigModule,
    SettingsModule,
    VideoWorkerQueueModule,
  ],
  controllers: [PipelineController],
  providers: [
    PipelineService,
    FrameExtractService,
    BrandEditService,
    DeepSynthesisMarkerService,
    VideoGenService,
    SubtitleService,
    DedupService,
    QualityCheckService,
    PromptOptimizerService,
  ],
  exports: [PipelineService, PromptOptimizerService],
})
export class PipelineModule {}
