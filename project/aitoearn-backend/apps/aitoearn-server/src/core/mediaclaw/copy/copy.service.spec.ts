import { describeModuleSpec } from '../testing/module-spec.factory'
import { CopyController } from './copy.controller'
import { CopyModule } from './copy.module'
import { CopyService } from './copy.service'

describeModuleSpec<CopyService>({
  suiteName: 'CopyModule',
  module: CopyModule,
  service: CopyService,
  controller: CopyController,
  keyMethods: ['generateCopy'],
})
