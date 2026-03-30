import { describeModuleSpec } from '../testing/module-spec.factory'
import { WebhookController } from './webhook.controller'
import { WebhookModule } from './webhook.module'
import { WebhookService } from './webhook.service'

describeModuleSpec<WebhookService>({
  suiteName: 'WebhookModule',
  module: WebhookModule,
  service: WebhookService,
  controller: WebhookController,
  keyMethods: ['register', 'listByOrg', 'trigger'],
})
