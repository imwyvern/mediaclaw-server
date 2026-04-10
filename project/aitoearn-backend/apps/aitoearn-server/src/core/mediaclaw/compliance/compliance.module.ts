import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ComplianceDeletionRequest,
  ComplianceDeletionRequestSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { AuditModule } from '../audit/audit.module'
import { ComplianceController } from './compliance.controller'
import { ComplianceService } from './compliance.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ComplianceDeletionRequest.name, schema: ComplianceDeletionRequestSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    AuditModule,
  ],
  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
