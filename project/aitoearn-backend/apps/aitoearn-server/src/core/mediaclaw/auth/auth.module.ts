import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { MongooseModule } from '@nestjs/mongoose'
import {
  MediaClawUser,
  MediaClawUserSchema,
  Organization,
  OrganizationSchema,
  Subscription,
  SubscriptionSchema,
  VideoPack,
  VideoPackSchema,
} from '@yikart/mongodb'
import { McAuthController } from './auth.controller'
import { EnterpriseAuthService } from './enterprise-auth.service'
import { McAuthService } from './auth.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    JwtModule.register({
      secret: process.env['JWT_SECRET'] || 'mediaclaw-dev-secret',
      signOptions: { expiresIn: '2h' },
    }),
  ],
  controllers: [McAuthController],
  providers: [McAuthService, EnterpriseAuthService],
  exports: [McAuthService, EnterpriseAuthService],
})
export class McAuthModule {}
