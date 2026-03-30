import { describeModuleSpec } from '../testing/module-spec.factory'
import { DiscoveryController } from './discovery.controller'
import { DiscoveryModule } from './discovery.module'
import { DiscoveryService } from './discovery.service'

describeModuleSpec<DiscoveryService>({
  suiteName: 'DiscoveryModule',
  module: DiscoveryModule,
  service: DiscoveryService,
  controller: DiscoveryController,
  keyMethods: ['getRecommendationPool', 'markRemixed', 'scheduledDiscoveryScan'],
})
