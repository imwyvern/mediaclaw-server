import { Module } from '@nestjs/common'
import { MediaclawController } from './mediaclaw.controller'
import { MediaclawService } from './mediaclaw.service'

@Module({
  controllers: [MediaclawController],
  providers: [MediaclawService],
  exports: [MediaclawService],
})
export class MediaclawModule {}
