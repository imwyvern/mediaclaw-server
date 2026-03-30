import { describeModuleSpec } from '../testing/module-spec.factory'
import { McAccountController } from './account.controller'
import { McAccountModule } from './account.module'
import { McAccountService } from './account.service'

describeModuleSpec<McAccountService>({
  suiteName: 'McAccountModule',
  module: McAccountModule,
  service: McAccountService,
  controller: McAccountController,
  keyMethods: ['getInfo', 'getUsage', 'updateProfile'],
})
