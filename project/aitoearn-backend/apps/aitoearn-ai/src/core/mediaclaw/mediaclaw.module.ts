import { Module } from '@nestjs/common'
import { MediaclawController } from './mediaclaw.controller'
import { MediaclawProcessor } from './mediaclaw.processor'
import { MediaclawService } from './mediaclaw.service'

@Module({
  controllers: [MediaclawController],
  providers: [MediaclawService, MediaclawProcessor],
  exports: [MediaclawService],
})
export class MediaclawModule {}
