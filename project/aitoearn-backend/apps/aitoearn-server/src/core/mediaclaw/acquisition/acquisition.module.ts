import { Module } from '@nestjs/common'
import { AcquisitionController } from './acquisition.controller'
import { AcquisitionService } from './acquisition.service'
import { CONTENT_PROVIDERS } from './content-provider.interface'
import { TikHubService } from './tikhub.service'

@Module({
  controllers: [AcquisitionController],
  providers: [
    TikHubService,
    AcquisitionService,
    {
      provide: CONTENT_PROVIDERS,
      inject: [TikHubService],
      useFactory: (tikHubService: TikHubService) => [tikHubService],
    },
  ],
  exports: [AcquisitionService, TikHubService],
})
export class AcquisitionModule {}
