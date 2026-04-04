import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Brand, BrandSchema, Pipeline, PipelineSchema, VideoTask, VideoTaskSchema } from '@yikart/mongodb'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { ModelResolverModule } from '../model-resolver/model-resolver.module'
import { BrandEditService } from './brand-edit.service'
import { DeepSynthesisMarkerService } from './deep-synthesis-marker.service'
import { DedupService } from './dedup.service'
import { FrameExtractService } from './frame-extract.service'
import { PipelineController } from './pipeline.controller'
import { PipelineService } from './pipeline.service'
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
    ModelResolverModule,
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
  ],
  exports: [PipelineService],
})
export class PipelineModule {}
