import { describeModuleSpec } from '../testing/module-spec.factory'
import { AcquisitionController } from './acquisition.controller'
import { AcquisitionModule } from './acquisition.module'
import { AcquisitionService } from './acquisition.service'

describeModuleSpec<AcquisitionService>({
  suiteName: 'AcquisitionModule',
  module: AcquisitionModule,
  service: AcquisitionService,
  controller: AcquisitionController,
  keyMethods: ['searchVideos', 'getVideoDetail', 'getSourceVideo'],
})
