import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { VideoTask, VideoTaskSchema } from '@yikart/mongodb'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsService } from './analytics.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
