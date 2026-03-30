import { describeModuleSpec } from '../testing/module-spec.factory'
import { PipelineSystemController } from './pipeline-system.controller'
import { PipelineSystemModule } from './pipeline-system.module'
import { PipelineSystemService } from './pipeline-system.service'

describeModuleSpec<PipelineSystemService>({
  suiteName: 'PipelineSystemModule',
  module: PipelineSystemModule,
  service: PipelineSystemService,
  controller: PipelineSystemController,
  keyMethods: ['createTemplate', 'listTemplates', 'applyTemplate'],
})
