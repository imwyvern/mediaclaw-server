import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ClawHostInstance, ClawHostInstanceSchema } from '@yikart/mongodb'
import { MediaClawApiKeyModule } from '../apikey/apikey.module'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { ClawHostAlertService } from './clawhost-alert.service'
import { ClawHostBindingController } from './clawhost-binding.controller'
import { ClawHostRuntimeService } from './clawhost-runtime.service'
import { ClawHostController } from './clawhost.controller'
import { ClawHostService } from './clawhost.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClawHostInstance.name, schema: ClawHostInstanceSchema },
    ]),
    MediaClawApiKeyModule,
    MediaclawConfigModule,
  ],
  controllers: [ClawHostController, ClawHostBindingController],
  providers: [ClawHostService, ClawHostRuntimeService, ClawHostAlertService],
  exports: [ClawHostService],
})
export class ClawHostModule {}
