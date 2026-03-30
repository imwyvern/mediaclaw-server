import { Module } from '@nestjs/common'
import { McAccountController } from './account.controller'
import { McAccountService } from './account.service'

@Module({
  controllers: [McAccountController],
  providers: [McAccountService],
  exports: [McAccountService],
})
export class McAccountModule {}
