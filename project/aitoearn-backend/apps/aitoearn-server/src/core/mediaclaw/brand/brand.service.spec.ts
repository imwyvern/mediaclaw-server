import { describeModuleSpec } from '../testing/module-spec.factory'
import { BrandController } from './brand.controller'
import { BrandModule } from './brand.module'
import { BrandService } from './brand.service'

describeModuleSpec<BrandService>({
  suiteName: 'BrandModule',
  module: BrandModule,
  service: BrandService,
  controller: BrandController,
  keyMethods: ['create', 'findByOrg', 'update'],
})
