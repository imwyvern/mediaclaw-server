import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  PlatformAccount,
  PlatformAccountSchema,
  PublishRecord,
  PublishRecordSchema,
} from '@yikart/mongodb'
import { PlatformAccountController } from './platform-account.controller'
import { PlatformAccountService } from './platform-account.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformAccount.name, schema: PlatformAccountSchema },
      { name: PublishRecord.name, schema: PublishRecordSchema },
    ]),
  ],
  controllers: [PlatformAccountController],
  providers: [PlatformAccountService],
  exports: [PlatformAccountService],
})
export class PlatformAccountModule {}
