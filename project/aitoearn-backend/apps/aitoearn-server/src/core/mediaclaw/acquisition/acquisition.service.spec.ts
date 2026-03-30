import { describeModuleSpec } from '../testing/module-spec.factory'
import { AcquisitionController } from './acquisition.controller'
import { AcquisitionModule } from './acquisition.module'
import { TikHubService } from './tikhub.service'

describeModuleSpec<TikHubService>({
  suiteName: 'AcquisitionModule',
  module: AcquisitionModule,
  service: TikHubService,
  controller: AcquisitionController,
  keyMethods: ['searchVideos', 'getVideoDetail', 'getSourceVideo'],
})
