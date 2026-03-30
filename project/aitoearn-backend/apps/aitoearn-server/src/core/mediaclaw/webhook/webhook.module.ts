import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Webhook, WebhookSchema } from '@yikart/mongodb'
import { WebhookController } from './webhook.controller'
import { WebhookService } from './webhook.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Webhook.name, schema: WebhookSchema },
    ]),
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
