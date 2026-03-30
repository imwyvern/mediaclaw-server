import { describeModuleSpec } from '../testing/module-spec.factory'
import { McAuthController } from './auth.controller'
import { McAuthModule } from './auth.module'
import { McAuthService } from './auth.service'

describeModuleSpec<McAuthService>({
  suiteName: 'McAuthModule',
  module: McAuthModule,
  service: McAuthService,
  controller: McAuthController,
  keyMethods: ['validatePhoneNumber', 'sendSmsCode', 'refreshToken'],
})
