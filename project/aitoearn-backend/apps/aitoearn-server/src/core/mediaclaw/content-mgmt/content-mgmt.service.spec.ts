import { describeModuleSpec } from '../testing/module-spec.factory'
import { ContentMgmtController } from './content-mgmt.controller'
import { ContentMgmtModule } from './content-mgmt.module'
import { ContentMgmtService } from './content-mgmt.service'

describeModuleSpec<ContentMgmtService>({
  suiteName: 'ContentMgmtModule',
  module: ContentMgmtModule,
  service: ContentMgmtService,
  controller: ContentMgmtController,
  keyMethods: ['editCopy', 'listContent', 'getContent'],
})
