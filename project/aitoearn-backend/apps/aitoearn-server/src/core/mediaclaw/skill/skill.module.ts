import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Brand, BrandSchema, Pipeline, PipelineSchema, VideoTask, VideoTaskSchema } from '@yikart/mongodb'
import { MediaClawApiKeyModule } from '../apikey/apikey.module'
import { SkillController } from './skill.controller'
import { SkillService } from './skill.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Brand.name, schema: BrandSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    MediaClawApiKeyModule,
  ],
  controllers: [SkillController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
