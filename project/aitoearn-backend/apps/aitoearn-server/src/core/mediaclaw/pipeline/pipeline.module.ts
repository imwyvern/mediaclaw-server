import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Brand, BrandSchema, Pipeline, PipelineSchema } from '@yikart/mongodb'
import { BrandEditService } from './brand-edit.service'
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
    ]),
  ],
  controllers: [PipelineController],
  providers: [
    PipelineService,
    FrameExtractService,
    BrandEditService,
    VideoGenService,
    SubtitleService,
    DedupService,
    QualityCheckService,
  ],
  exports: [PipelineService],
})
export class PipelineModule {}
