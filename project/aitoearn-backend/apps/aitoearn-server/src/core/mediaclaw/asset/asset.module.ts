import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandAssetVersion,
  BrandAssetVersionSchema,
  BrandSchema,
} from '@yikart/mongodb'
import { AssetController } from './asset.controller'
import { AssetService } from './asset.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Brand.name, schema: BrandSchema },
      { name: BrandAssetVersion.name, schema: BrandAssetVersionSchema },
    ]),
  ],
  controllers: [AssetController],
  providers: [AssetService],
  exports: [AssetService],
})
export class MediaClawAssetModule {}
