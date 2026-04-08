import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ContentHash,
  ContentHashSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { AiJudgeService } from './ai-judge.service'
import { DedupController } from './dedup.controller'
import { DedupService } from './dedup.service'
import { EmbeddingService } from './embedding.service'
import { MilvusService } from './milvus.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContentHash.name, schema: ContentHashSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
  ],
  controllers: [DedupController],
  providers: [DedupService, MilvusService, EmbeddingService, AiJudgeService],
  exports: [DedupService, MilvusService, EmbeddingService],
})
export class DedupModule {}
