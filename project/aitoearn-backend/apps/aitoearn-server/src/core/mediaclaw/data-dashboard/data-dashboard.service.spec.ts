import { describeModuleSpec } from '../testing/module-spec.factory'
import { DataDashboardController } from './data-dashboard.controller'
import { DataDashboardModule } from './data-dashboard.module'
import { DataDashboardService } from './data-dashboard.service'

describeModuleSpec<DataDashboardService>({
  suiteName: 'DataDashboardModule',
  module: DataDashboardModule,
  service: DataDashboardService,
  controller: DataDashboardController,
  keyMethods: ['getContentHealth', 'getCompetitorBenchmark', 'exportReport'],
})
