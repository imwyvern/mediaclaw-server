import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { finalize } from 'rxjs/operators'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { UsageService } from './usage.service'

interface UsageTrackingRequest extends Record<string, unknown> {
  originalUrl?: string
  url?: string
  baseUrl?: string
  route?: { path?: string }
  headers: { authorization?: string }
  body?: { orgId?: string }
  query?: { orgId?: string }
  method?: string
  user?: MediaClawAuthUser
}

@Injectable()
export class UsageTrackingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UsageTrackingInterceptor.name)

  constructor(private readonly usageService: UsageService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const request = context.switchToHttp().getRequest<UsageTrackingRequest>()
    const url = request.originalUrl || request.url || ''
    if (!url.startsWith('/api/v1')) {
      return next.handle()
    }

    const startedAt = Date.now()

    return next.handle().pipe(
      finalize(() => {
        const user = request.user
        const orgId = user?.orgId || user?.id || request.body?.orgId || request.query?.orgId || ''
        if (!orgId) {
          return
        }

        const endpoint = this.resolveEndpoint(request)
        const apiKey = user?.apiKeyId || this.resolveApiKey(request)
        const method = request.method?.toUpperCase() || 'GET'
        const responseTimeMs = Date.now() - startedAt

        void this.usageService.trackRequest(
          orgId,
          apiKey,
          endpoint,
          method,
          responseTimeMs,
        ).catch((error) => {
          this.logger.error(JSON.stringify({
            message: 'Failed to track api usage',
            endpoint,
            error: error instanceof Error ? error.message : String(error),
          }))
        })
      }),
    )
  }

  private resolveEndpoint(request: UsageTrackingRequest) {
    const baseUrl = request.baseUrl || ''
    const routePath = request.route?.path || ''

    if (baseUrl || routePath) {
      return `${baseUrl}${routePath}` || request.originalUrl || request.url || ''
    }

    return (request.originalUrl || request.url || '').split('?')[0]
  }

  private resolveApiKey(request: UsageTrackingRequest) {
    const authorization = request.headers.authorization || ''
    const [scheme, token] = authorization.split(' ')
    if (scheme === 'Bearer' && token?.startsWith('mc_live_')) {
      return token.slice(0, 16)
    }

    return 'session'
  }
}
