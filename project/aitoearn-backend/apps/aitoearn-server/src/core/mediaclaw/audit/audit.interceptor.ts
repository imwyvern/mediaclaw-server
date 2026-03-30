import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { AuditService } from './audit.service'

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name)

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const request = context.switchToHttp().getRequest()
    const response = context.switchToHttp().getResponse()
    const method = request.method?.toUpperCase()

    if (!['POST', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle()
    }

    const user = request['user']
    const orgId = user?.orgId || user?.id
    if (!orgId) {
      return next.handle()
    }

    const routePath = request.route?.path || request.originalUrl || request.url || ''
    const resource = this.extractResource(routePath)

    return next.handle().pipe(
      tap(() => {
        void this.auditService.log({
          orgId,
          userId: user?.id,
          action: `${method} ${routePath}`,
          resource,
          resourceId: request.params?.id || request.params?.resourceId || '',
          details: {
            method,
            path: request.originalUrl || request.url,
            params: request.params || {},
            query: this.sanitizeRecord(request.query || {}),
            body: this.sanitizeRecord(request.body || {}),
            statusCode: response.statusCode,
          },
          ipAddress: request.ip || request.headers['x-forwarded-for'] || '',
          userAgent: request.headers['user-agent'] || '',
        }).catch((error) => {
          this.logger.error({
            message: 'Failed to write audit log from interceptor',
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }),
    )
  }

  private extractResource(path: string) {
    const cleanedPath = path.split('?')[0]
    const segments = cleanedPath.split('/').filter(Boolean)

    if (segments.length >= 3 && segments[0] === 'api' && segments[1] === 'v1') {
      return segments[2]
    }

    return segments[0] || 'unknown'
  }

  private sanitizeRecord(value: Record<string, any>) {
    const redactedKeys = new Set(['password', 'token', 'secret', 'authorization', 'apiKey', 'x-api-key'])
    const sanitized: Record<string, any> = {}

    for (const [key, rawValue] of Object.entries(value)) {
      sanitized[key] = redactedKeys.has(key)
        ? '[REDACTED]'
        : rawValue
    }

    return sanitized
  }
}
