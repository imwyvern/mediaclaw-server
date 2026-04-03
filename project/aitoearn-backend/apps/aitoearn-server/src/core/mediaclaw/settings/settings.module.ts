import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Organization, OrganizationSchema } from '@yikart/mongodb'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { ByokService } from './byok.service'
import { SettingsController } from './settings.controller'

@Module({
  imports: [
    MediaclawConfigModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [SettingsController],
  providers: [ByokService],
  exports: [ByokService],
})
export class SettingsModule {}
