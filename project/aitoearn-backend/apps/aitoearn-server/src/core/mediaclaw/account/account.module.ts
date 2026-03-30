import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  MediaClawUser,
  MediaClawUserSchema,
  VideoPack,
  VideoPackSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { McAccountController } from './account.controller'
import { McAccountService } from './account.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
  ],
  controllers: [McAccountController],
  providers: [McAccountService],
  exports: [McAccountService],
})
export class McAccountModule {}
