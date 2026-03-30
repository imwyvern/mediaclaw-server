import { describeModuleSpec } from '../testing/module-spec.factory'
import { AuditController } from './audit.controller'
import { AuditModule } from './audit.module'
import { AuditService } from './audit.service'

describeModuleSpec<AuditService>({
  suiteName: 'AuditModule',
  module: AuditModule,
  service: AuditService,
  controller: AuditController,
  keyMethods: ['log', 'query'],
})
