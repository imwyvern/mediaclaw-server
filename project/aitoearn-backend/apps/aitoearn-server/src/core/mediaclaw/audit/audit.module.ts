import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { MongooseModule } from '@nestjs/mongoose'
import { AuditLog, AuditLogSchema } from '@yikart/mongodb'
import { AuditController } from './audit.controller'
import { AuditInterceptor } from './audit.interceptor'
import { AuditService } from './audit.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: AuditInterceptor,
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
