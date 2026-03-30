import { Injectable, NestMiddleware } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'

/**
 * TenantMiddleware extracts orgId from the JWT payload
 * and attaches it to the request for downstream use.
 * 
 * All queries should use req.orgId for tenant isolation.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const user = (req as any)['user']
    if (user?.orgId) {
      ;(req as any)['orgId'] = user.orgId
    }
    next()
  }
}
