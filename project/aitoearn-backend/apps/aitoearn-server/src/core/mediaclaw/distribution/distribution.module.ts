import { Module } from '@nestjs/common'
import { WebhookModule } from '../webhook/webhook.module'
import { DistributionService } from './distribution.service'

@Module({
  imports: [WebhookModule],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
