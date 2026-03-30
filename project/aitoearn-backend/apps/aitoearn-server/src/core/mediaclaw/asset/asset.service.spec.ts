import { describeModuleSpec } from '../testing/module-spec.factory'
import { AssetController } from './asset.controller'
import { MediaClawAssetModule } from './asset.module'
import { AssetService } from './asset.service'

describeModuleSpec<AssetService>({
  suiteName: 'MediaClawAssetModule',
  module: MediaClawAssetModule,
  service: AssetService,
  controller: AssetController,
  keyMethods: ['uploadAsset', 'listVersions', 'setActive'],
})
