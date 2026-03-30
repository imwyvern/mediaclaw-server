import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Competitor,
  CompetitorSchema,
  ViralContent,
  ViralContentSchema,
} from '@yikart/mongodb'
import { CompetitorController } from './competitor.controller'
import { CompetitorService } from './competitor.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Competitor.name, schema: CompetitorSchema },
      { name: ViralContent.name, schema: ViralContentSchema },
    ]),
  ],
  controllers: [CompetitorController],
  providers: [CompetitorService],
  exports: [CompetitorService],
})
export class CompetitorModule {}
