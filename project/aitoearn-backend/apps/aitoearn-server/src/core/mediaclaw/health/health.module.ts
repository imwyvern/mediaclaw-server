import { Module } from '@nestjs/common'
import { VideoWorkerQueueModule } from '../worker/video-worker-queue.module'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'

@Module({
  imports: [VideoWorkerQueueModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
