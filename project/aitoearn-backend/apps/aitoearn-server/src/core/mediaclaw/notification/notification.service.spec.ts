import { describeModuleSpec } from '../testing/module-spec.factory'
import { NotificationController } from './notification.controller'
import { NotificationModule } from './notification.module'
import { NotificationService } from './notification.service'

describeModuleSpec<NotificationService>({
  suiteName: 'NotificationModule',
  module: NotificationModule,
  service: NotificationService,
  controller: NotificationController,
  keyMethods: ['createConfig', 'listConfigs', 'send'],
})
