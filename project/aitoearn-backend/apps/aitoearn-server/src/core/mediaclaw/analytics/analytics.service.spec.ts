import { describeModuleSpec } from '../testing/module-spec.factory'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsModule } from './analytics.module'
import { AnalyticsService } from './analytics.service'

describeModuleSpec<AnalyticsService>({
  suiteName: 'AnalyticsModule',
  module: AnalyticsModule,
  service: AnalyticsService,
  controller: AnalyticsController,
  keyMethods: ['getOverview', 'getVideoStats', 'getTopContent'],
})
