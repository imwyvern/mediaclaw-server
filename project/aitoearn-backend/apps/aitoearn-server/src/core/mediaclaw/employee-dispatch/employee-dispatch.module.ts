import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  EmployeeAssignment,
  EmployeeAssignmentSchema,
  PlatformAccount,
  PlatformAccountSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { EmployeeDispatchService } from './employee-dispatch.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmployeeAssignment.name, schema: EmployeeAssignmentSchema },
      { name: PlatformAccount.name, schema: PlatformAccountSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
  ],
  providers: [EmployeeDispatchService],
  exports: [EmployeeDispatchService],
})
export class EmployeeDispatchModule {}
