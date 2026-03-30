import { describeModuleSpec } from '../testing/module-spec.factory'
import { ReportController } from './report.controller'
import { ReportModule } from './report.module'
import { ReportService } from './report.service'

describeModuleSpec<ReportService>({
  suiteName: 'ReportModule',
  module: ReportModule,
  service: ReportService,
  controller: ReportController,
  keyMethods: ['generateReport', 'listReports', 'scheduleAutoReport'],
})
