import { describeModuleSpec } from '../testing/module-spec.factory'
import { MarketplaceController } from './marketplace.controller'
import { MarketplaceModule } from './marketplace.module'
import { MarketplaceService } from './marketplace.service'

describeModuleSpec<MarketplaceService>({
  suiteName: 'MarketplaceModule',
  module: MarketplaceModule,
  service: MarketplaceService,
  controller: MarketplaceController,
  keyMethods: ['publishTemplate', 'listTemplates', 'purchaseTemplate'],
})
