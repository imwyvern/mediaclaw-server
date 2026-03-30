import { describeModuleSpec } from '../testing/module-spec.factory'
import { PlatformAccountController } from './platform-account.controller'
import { PlatformAccountModule } from './platform-account.module'
import { PlatformAccountService } from './platform-account.service'

describeModuleSpec<PlatformAccountService>({
  suiteName: 'PlatformAccountModule',
  module: PlatformAccountModule,
  service: PlatformAccountService,
  controller: PlatformAccountController,
  keyMethods: ['addAccount', 'listAccounts', 'getPublishHistory'],
})
