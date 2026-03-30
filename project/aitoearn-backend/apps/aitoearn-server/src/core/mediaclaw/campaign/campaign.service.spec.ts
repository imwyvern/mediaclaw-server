import { describeModuleSpec } from '../testing/module-spec.factory'
import { CampaignController } from './campaign.controller'
import { CampaignModule } from './campaign.module'
import { CampaignService } from './campaign.service'

describeModuleSpec<CampaignService>({
  suiteName: 'CampaignModule',
  module: CampaignModule,
  service: CampaignService,
  controller: CampaignController,
  keyMethods: ['create', 'findByOrg', 'start'],
})
