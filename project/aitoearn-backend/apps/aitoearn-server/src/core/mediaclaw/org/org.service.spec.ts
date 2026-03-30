import { describeModuleSpec } from '../testing/module-spec.factory'
import { OrgController } from './org.controller'
import { OrgModule } from './org.module'
import { OrgService } from './org.service'

describeModuleSpec<OrgService>({
  suiteName: 'OrgModule',
  module: OrgModule,
  service: OrgService,
  controller: OrgController,
  keyMethods: ['createForCurrentOrg', 'findById', 'update'],
})
