import { describeModuleSpec } from '../testing/module-spec.factory'
import { SkillController } from './skill.controller'
import { SkillModule } from './skill.module'
import { SkillService } from './skill.service'

describeModuleSpec<SkillService>({
  suiteName: 'SkillModule',
  module: SkillModule,
  service: SkillService,
  controller: SkillController,
  keyMethods: ['registerAgent', 'getAgentConfig', 'confirmDelivery'],
})
