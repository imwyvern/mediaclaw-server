import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { McAuthController } from './auth.controller'
import { McAuthService } from './auth.service'

@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'] || 'mediaclaw-dev-secret',
      signOptions: { expiresIn: '2h' },
    }),
  ],
  controllers: [McAuthController],
  providers: [McAuthService],
  exports: [McAuthService],
})
export class McAuthModule {}
