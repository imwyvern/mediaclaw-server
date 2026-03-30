import type { Request } from 'express'
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { UserRole } from '@yikart/mongodb'
import { verify } from 'jsonwebtoken'

export interface QueueDashboardJwtPayload {
  id: string
  orgId?: string | null
  role?: UserRole
  phone?: string
  name?: string
  iat?: number
  exp?: number
}

@Injectable()
export class QueueDashboardAuthService {
  private readonly jwtSecret = process.env['JWT_SECRET'] || 'mediaclaw-dev-secret'

  authorize(request: Request): QueueDashboardJwtPayload {
    const token = this.extractBearerToken(request.headers.authorization)

    if (!token) {
      throw new UnauthorizedException('Missing bearer token')
    }

    let payload: string | QueueDashboardJwtPayload
    try {
      payload = verify(token, this.jwtSecret) as string | QueueDashboardJwtPayload
    }
    catch {
      throw new UnauthorizedException('Invalid bearer token')
    }

    if (typeof payload !== 'object' || !payload || payload.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required')
    }

    return payload
  }

  private extractBearerToken(authorization?: string | string[]) {
    const header = Array.isArray(authorization) ? authorization[0] : authorization
    if (!header) {
      return null
    }

    const [scheme, token] = header.split(' ')
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return null
    }

    return token
  }
}
