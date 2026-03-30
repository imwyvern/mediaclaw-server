import { describeModuleSpec } from '../testing/module-spec.factory'
import { CompetitorController } from './competitor.controller'
import { CompetitorModule } from './competitor.module'
import { CompetitorService } from './competitor.service'

describeModuleSpec<CompetitorService>({
  suiteName: 'CompetitorModule',
  module: CompetitorModule,
  service: CompetitorService,
  controller: CompetitorController,
  keyMethods: ['addCompetitor', 'listCompetitors', 'getIndustryHot'],
})
