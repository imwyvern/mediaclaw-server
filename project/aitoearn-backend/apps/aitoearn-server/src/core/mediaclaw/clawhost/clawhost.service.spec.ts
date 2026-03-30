import { describeModuleSpec } from '../testing/module-spec.factory'
import { ClawHostController } from './clawhost.controller'
import { ClawHostModule } from './clawhost.module'
import { ClawHostService } from './clawhost.service'

describeModuleSpec<ClawHostService>({
  suiteName: 'ClawHostModule',
  module: ClawHostModule,
  service: ClawHostService,
  controller: ClawHostController,
  keyMethods: ['createInstance', 'listInstances', 'runHealthCheck'],
})
