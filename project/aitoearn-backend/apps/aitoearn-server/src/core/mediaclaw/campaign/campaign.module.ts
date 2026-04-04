import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Campaign, CampaignSchema, VideoTask, VideoTaskSchema } from '@yikart/mongodb'
import { CampaignController } from './campaign.controller'
import { CampaignService } from './campaign.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
  ],
  controllers: [CampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
