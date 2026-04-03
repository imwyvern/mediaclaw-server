import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { MongooseModule } from '@nestjs/mongoose'
import {
  EnterpriseInvite,
  EnterpriseInviteSchema,
  MediaClawUser,
  MediaClawUserSchema,
  Organization,
  OrganizationSchema,
  Subscription,
  SubscriptionSchema,
  VideoPack,
  VideoPackSchema,
} from '@yikart/mongodb'
import { getRequiredEnv } from '../mediaclaw-env.util'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { McAuthController } from './auth.controller'
import { McAuthService } from './auth.service'
import { EnterpriseAuthService } from './enterprise-auth.service'

@Module({
  imports: [
    MediaclawConfigModule,
    MongooseModule.forFeature([
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: EnterpriseInvite.name, schema: EnterpriseInviteSchema },
    ]),
    JwtModule.register({
      secret: getRequiredEnv('JWT_SECRET'),
      signOptions: { expiresIn: '2h' },
    }),
  ],
  controllers: [McAuthController],
  providers: [McAuthService, EnterpriseAuthService],
  exports: [McAuthService, EnterpriseAuthService],
})
export class McAuthModule {}
