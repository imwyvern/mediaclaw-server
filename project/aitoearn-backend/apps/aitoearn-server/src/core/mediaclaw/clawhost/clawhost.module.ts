import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ClawHostInstance, ClawHostInstanceSchema } from '@yikart/mongodb'
import { MediaClawApiKeyModule } from '../apikey/apikey.module'
import { ClawHostBindingController } from './clawhost-binding.controller'
import { ClawHostController } from './clawhost.controller'
import { ClawHostService } from './clawhost.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClawHostInstance.name, schema: ClawHostInstanceSchema },
    ]),
    MediaClawApiKeyModule,
  ],
  controllers: [ClawHostController, ClawHostBindingController],
  providers: [ClawHostService],
  exports: [ClawHostService],
})
export class ClawHostModule {}
