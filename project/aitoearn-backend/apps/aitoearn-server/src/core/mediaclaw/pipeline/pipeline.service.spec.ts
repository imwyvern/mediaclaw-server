import { describeModuleSpec } from '../testing/module-spec.factory'
import { PipelineController } from './pipeline.controller'
import { PipelineModule } from './pipeline.module'
import { PipelineService } from './pipeline.service'

describeModuleSpec<PipelineService>({
  suiteName: 'PipelineModule',
  module: PipelineModule,
  service: PipelineService,
  controller: PipelineController,
  keyMethods: ['create', 'findByOrg', 'analyzeSource', 'renderVideo', 'runQualityCheck', 'archive'],
})
