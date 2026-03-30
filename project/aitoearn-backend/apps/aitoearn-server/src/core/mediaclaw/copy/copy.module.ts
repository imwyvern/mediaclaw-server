import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Brand, BrandSchema } from '@yikart/mongodb'
import { CopyService } from './copy.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Brand.name, schema: BrandSchema },
    ]),
  ],
  providers: [CopyService],
  exports: [CopyService],
})
export class CopyModule {}
