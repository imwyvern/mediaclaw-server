import { describeModuleSpec } from '../testing/module-spec.factory'
import { MediaClawApiKeyController } from './apikey.controller'
import { MediaClawApiKeyModule } from './apikey.module'
import { MediaClawApiKeyService } from './apikey.service'

describeModuleSpec<MediaClawApiKeyService>({
  suiteName: 'MediaClawApiKeyModule',
  module: MediaClawApiKeyModule,
  service: MediaClawApiKeyService,
  controller: MediaClawApiKeyController,
  keyMethods: ['create', 'list', 'validate'],
})
