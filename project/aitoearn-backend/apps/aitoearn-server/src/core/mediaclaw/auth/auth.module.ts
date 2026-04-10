import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ClawHostInstance,
  ClawHostInstanceSchema,
  EnterpriseInvite,
  EnterpriseInviteSchema,
  EnterpriseSsoProvider,
  EnterpriseSsoProviderSchema,
  MediaClawUser,
  MediaClawUserSchema,
  Organization,
  OrganizationSchema,
  Subscription,
  SubscriptionSchema,
  VideoPack,
  VideoPackSchema,
} from '@yikart/mongodb'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { getRequiredEnv } from '../mediaclaw-env.util'
import { McAuthController } from './auth.controller'
import { McAuthService } from './auth.service'
import { EnterpriseAuthService } from './enterprise-auth.service'
import { EnterpriseSsoService } from './enterprise-sso.service'
import { PersonalSharedExperienceService } from './personal-shared-experience.service'

@Module({
  imports: [
    MediaclawConfigModule,
    MongooseModule.forFeature([
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: ClawHostInstance.name, schema: ClawHostInstanceSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: EnterpriseInvite.name, schema: EnterpriseInviteSchema },
      { name: EnterpriseSsoProvider.name, schema: EnterpriseSsoProviderSchema },
    ]),
    JwtModule.register({
      secret: getRequiredEnv('JWT_SECRET'),
      signOptions: { expiresIn: '2h' },
    }),
  ],
  controllers: [McAuthController],
  providers: [
    McAuthService,
    EnterpriseAuthService,
    EnterpriseSsoService,
    PersonalSharedExperienceService,
  ],
  exports: [
    McAuthService,
    EnterpriseAuthService,
    EnterpriseSsoService,
    PersonalSharedExperienceService,
  ],
})
export class McAuthModule {}
