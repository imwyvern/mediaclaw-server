import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Brand, BrandSchema, Pipeline, PipelineSchema, VideoTask, VideoTaskSchema } from '@yikart/mongodb'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { ModelResolverModule } from '../model-resolver/model-resolver.module'
import { BrandEditService } from './brand-edit.service'
import { CanvasRendererService } from './canvas-renderer.service'
import { DedupService } from './dedup.service'
import { DeepSynthesisMarkerService } from './deep-synthesis-marker.service'
import { FrameExtractService } from './frame-extract.service'
import { PipelinePreferenceLearningService } from './pipeline-preference-learning.service'
import { PipelineStyleRewriteService } from './pipeline-style-rewrite.service'
import { PipelineController } from './pipeline.controller'
import { PipelineService } from './pipeline.service'
import { QualityCheckService } from './quality-check.service'
import { SubtitleService } from './subtitle.service'
import { B7AiLiveTemplate } from './templates/b7-ai-live'
import { B9ProductShowcaseTemplate } from './templates/b9-product-showcase'
import { B10ExplainerTemplate } from './templates/b10-explainer'
import { TemplateRegistry } from './templates/template-registry'
import { TtsService } from './tts.service'
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
    PipelineStyleRewriteService,
    PipelinePreferenceLearningService,
    BrandEditService,
    CanvasRendererService,
    DeepSynthesisMarkerService,
    VideoGenService,
    SubtitleService,
    DedupService,
    QualityCheckService,
    TtsService,
    B7AiLiveTemplate,
    B9ProductShowcaseTemplate,
    B10ExplainerTemplate,
    TemplateRegistry,
  ],
  exports: [PipelineService],
})
export class PipelineModule {}
