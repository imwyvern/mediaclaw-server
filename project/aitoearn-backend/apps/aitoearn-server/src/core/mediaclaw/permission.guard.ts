import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

export const ROLES_KEY = 'roles'
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)

/**
 * PermissionGuard checks if the user's role matches
 * the required roles for the endpoint.
 *
 * Usage: @Roles('admin', 'editor') on controller method
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredRoles || requiredRoles.length === 0) {
      return true // No roles required
    }

    const request = context.switchToHttp().getRequest()
    const user = request['user']

    if (!user?.role) {
      throw new ForbiddenException('No role assigned')
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(`Role '${user.role}' is not authorized. Required: ${requiredRoles.join(', ')}`)
    }

    return true
  }
}
