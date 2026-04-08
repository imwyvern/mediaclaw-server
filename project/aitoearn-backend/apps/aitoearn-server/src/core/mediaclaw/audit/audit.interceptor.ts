import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { resolveAuditOperation } from './audit-action.mapper'
import { AuditService } from './audit.service'

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name)

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const request = context.switchToHttp().getRequest()
    const response = context.switchToHttp().getResponse()
    const method = request.method?.toUpperCase()
    const startedAt = Date.now()

    const user = request['user']
    const orgId = user?.['orgId'] || user?.['id']
    if (!orgId) {
      return next.handle()
    }

    const auditOperation = resolveAuditOperation({
      method,
      baseUrl: request.baseUrl,
      route: request.route,
      originalUrl: request.originalUrl,
      url: request.url,
      params: request.params,
      query: request.query,
      body: request.body,
    })

    if (!auditOperation) {
      return next.handle()
    }

    return next.handle().pipe(
      tap(() => {
        const ipAddress = this.resolveIpAddress(request)
        void this.auditService.log({
          orgId,
          userId: user?.['id'],
          userName: this.resolveUserName(user),
          action: auditOperation.action,
          resource: auditOperation.resource,
          resourceId: auditOperation.resourceId,
          target: auditOperation.target,
          meta: auditOperation.meta,
          details: {
            method,
            path: request.originalUrl || request.url,
            params: request.params || {},
            query: this.sanitizeRecord(request.query || {}),
            body: this.sanitizeRecord(request.body || {}),
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
          },
          ip: ipAddress,
          ipAddress,
          userAgent: request.headers?.['user-agent'] || '',
        }).catch((error) => {
          this.logger.error({
            message: 'Failed to write audit log from interceptor',
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }),
    )
  }

  private resolveUserName(user: Record<string, any> | undefined) {
    return user?.['name'] || user?.['displayName'] || user?.['email'] || user?.['phone'] || user?.['id'] || ''
  }

  private resolveIpAddress(request: Record<string, any>) {
    const forwardedFor = request?.['headers']?.['x-forwarded-for']
    if (Array.isArray(forwardedFor)) {
      return forwardedFor[0] || request['ip'] || ''
    }

    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0]?.trim() || request['ip'] || ''
    }

    return request['ip'] || ''
  }

  private sanitizeRecord(value: Record<string, unknown>) {
    const redactedKeys = new Set(['password', 'token', 'secret', 'authorization', 'apiKey', 'x-api-key'])
    const sanitized: Record<string, unknown> = {}

    for (const [key, rawValue] of Object.entries(value)) {
      sanitized[key] = redactedKeys.has(key)
        ? '[REDACTED]'
        : this.sanitizeValue(rawValue)
    }

    return sanitized
  }

  private sanitizeValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
    }

    if (Array.isArray(value)) {
      return value.map(item => this.sanitizeValue(item))
    }

    if (value && typeof value === 'object') {
      return this.sanitizeRecord(value as Record<string, unknown>)
    }

    return value
  }
}
