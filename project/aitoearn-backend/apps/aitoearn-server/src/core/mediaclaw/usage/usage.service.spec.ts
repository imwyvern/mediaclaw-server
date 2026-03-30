import { describeModuleSpec } from '../testing/module-spec.factory'
import { UsageController } from './usage.controller'
import { UsageModule } from './usage.module'
import { UsageService } from './usage.service'

describeModuleSpec<UsageService>({
  suiteName: 'UsageModule',
  module: UsageModule,
  service: UsageService,
  controller: UsageController,
  keyMethods: ['trackRequest', 'getUsageSummary', 'getQuotaStatus'],
})
