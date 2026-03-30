import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Organization,
  OrganizationSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { ContentMgmtController } from './content-mgmt.controller'
import { ContentMgmtService } from './content-mgmt.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [ContentMgmtController],
  providers: [ContentMgmtService],
  exports: [ContentMgmtService],
})
export class ContentMgmtModule {}
