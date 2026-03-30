import { describeModuleSpec } from '../testing/module-spec.factory'
import { ClientMgmtController } from './client-mgmt.controller'
import { ClientMgmtModule } from './client-mgmt.module'
import { ClientMgmtService } from './client-mgmt.service'

describeModuleSpec<ClientMgmtService>({
  suiteName: 'ClientMgmtModule',
  module: ClientMgmtModule,
  service: ClientMgmtService,
  controller: ClientMgmtController,
  keyMethods: ['listOrgs', 'getOrgDetail', 'inviteMember'],
})
