import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ClawHostInstance, ClawHostInstanceSchema } from '@yikart/mongodb'
import { ClawHostController } from './clawhost.controller'
import { ClawHostService } from './clawhost.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClawHostInstance.name, schema: ClawHostInstanceSchema },
    ]),
  ],
  controllers: [ClawHostController],
  providers: [ClawHostService],
  exports: [ClawHostService],
})
export class ClawHostModule {}
