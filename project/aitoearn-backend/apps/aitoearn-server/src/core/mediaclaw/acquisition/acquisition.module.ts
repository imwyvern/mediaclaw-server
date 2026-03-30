import { Module } from '@nestjs/common'
import { AcquisitionController } from './acquisition.controller'
import { TikHubService } from './tikhub.service'

@Module({
  controllers: [AcquisitionController],
  providers: [TikHubService],
  exports: [TikHubService],
})
export class AcquisitionModule {}
