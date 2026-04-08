import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  MediaClawUser,
  MediaClawUserSchema,
  Organization,
  OrganizationSchema,
} from '@yikart/mongodb'
import { McAuthModule } from '../auth/auth.module'
import { ModelResolverModule } from '../model-resolver/model-resolver.module'
import { OrgMemberAdminService } from './org-member-admin.service'
import { OrgController } from './org.controller'
import { OrgService } from './org.service'

@Module({
  imports: [
    McAuthModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
    ]),
    ModelResolverModule,
  ],
  controllers: [OrgController],
  providers: [OrgService, OrgMemberAdminService],
  exports: [OrgService, OrgMemberAdminService],
})
export class OrgModule {}
