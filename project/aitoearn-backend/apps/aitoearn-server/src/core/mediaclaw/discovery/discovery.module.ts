import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { VideoTask, VideoTaskSchema, ViralContent, ViralContentSchema } from '@yikart/mongodb'
import { DiscoveryController } from './discovery.controller'
import { DiscoveryService } from './discovery.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ViralContent.name, schema: ViralContentSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
  ],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
