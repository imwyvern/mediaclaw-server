import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  MediaClawUser,
  MediaClawUserSchema,
  Organization,
  OrganizationSchema,
} from '@yikart/mongodb'
import { ModelResolverModule } from '../model-resolver/model-resolver.module'
import { OrgController } from './org.controller'
import { OrgService } from './org.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
    ]),
    ModelResolverModule,
  ],
  controllers: [OrgController],
  providers: [OrgService],
  exports: [OrgService],
})
export class OrgModule {}
