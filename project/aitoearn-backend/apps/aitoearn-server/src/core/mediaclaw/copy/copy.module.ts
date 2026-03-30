import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Brand, BrandSchema, CopyHistory, CopyHistorySchema } from '@yikart/mongodb'
import { CopyEngineService } from './copy-engine.service'
import { CopyController } from './copy.controller'
import { CopyService } from './copy.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Brand.name, schema: BrandSchema },
      { name: CopyHistory.name, schema: CopyHistorySchema },
    ]),
  ],
  controllers: [CopyController],
  providers: [CopyEngineService, CopyService],
  exports: [CopyEngineService, CopyService],
})
export class CopyModule {}
