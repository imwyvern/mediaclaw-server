import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  CopyHistory,
  CopyHistorySchema,
  CopyPerformance,
  CopyPerformanceSchema,
  Organization,
  OrganizationSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { SettingsModule } from '../settings/settings.module'
import { CopyEngineService } from './copy-engine.service'
import { CopyStrategyService } from './copy-strategy.service'
import { CopyController } from './copy.controller'
import { CopyService } from './copy.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Brand.name, schema: BrandSchema },
      { name: CopyHistory.name, schema: CopyHistorySchema },
      { name: CopyPerformance.name, schema: CopyPerformanceSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    SettingsModule,
  ],
  controllers: [CopyController],
  providers: [CopyEngineService, CopyStrategyService, CopyService],
  exports: [CopyEngineService, CopyStrategyService, CopyService],
})
export class CopyModule {}
