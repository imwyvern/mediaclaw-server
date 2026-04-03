import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ContentHash, ContentHashSchema } from '@yikart/mongodb'
import { DedupController } from './dedup.controller'
import { DedupService } from './dedup.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContentHash.name, schema: ContentHashSchema },
    ]),
  ],
  controllers: [DedupController],
  providers: [DedupService],
  exports: [DedupService],
})
export class DedupModule {}
