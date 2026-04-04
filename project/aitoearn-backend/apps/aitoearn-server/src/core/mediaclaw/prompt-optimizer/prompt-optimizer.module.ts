import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  IterationLog,
  IterationLogSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { ModelResolverModule } from '../model-resolver/model-resolver.module'
import { SettingsModule } from '../settings/settings.module'
import { VideoWorkerQueueModule } from '../worker/video-worker-queue.module'
import { PromptOptimizerController } from './prompt-optimizer.controller'
import { PromptOptimizerLoopService } from './prompt-optimizer.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IterationLog.name, schema: IterationLogSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    ModelResolverModule,
    SettingsModule,
    VideoWorkerQueueModule,
  ],
  controllers: [PromptOptimizerController],
  providers: [PromptOptimizerLoopService],
  exports: [PromptOptimizerLoopService],
})
export class PromptOptimizerModule {}
