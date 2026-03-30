import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Organization, OrganizationSchema, VideoTask, VideoTaskSchema } from '@yikart/mongodb'
import { DataDashboardController } from './data-dashboard.controller'
import { DataDashboardService } from './data-dashboard.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [DataDashboardController],
  providers: [DataDashboardService],
  exports: [DataDashboardService],
})
export class DataDashboardModule {}
