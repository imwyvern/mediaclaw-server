import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ApiKey, ApiKeySchema } from '@yikart/mongodb'
import { MediaClawApiKeyController } from './apikey.controller'
import { MediaClawApiKeyGuard } from './apikey.guard'
import { MediaClawApiKeyService } from './apikey.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApiKey.name, schema: ApiKeySchema },
    ]),
  ],
  controllers: [MediaClawApiKeyController],
  providers: [MediaClawApiKeyService, MediaClawApiKeyGuard],
  exports: [MediaClawApiKeyService, MediaClawApiKeyGuard],
})
export class MediaClawApiKeyModule {}
