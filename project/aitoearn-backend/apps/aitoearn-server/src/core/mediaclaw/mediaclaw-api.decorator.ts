import { applyDecorators, Controller, UseGuards, UseInterceptors } from '@nestjs/common'
import { UserRole } from '@yikart/mongodb'
import { PermissionGuard, Roles } from './permission.guard'
import { UsageTrackingInterceptor } from './usage/usage-tracking.interceptor'

export function MediaClawApiController(path: string | string[]) {
  return applyDecorators(
    Controller(path),
    UseGuards(PermissionGuard),
    Roles(UserRole.EMPLOYEE),
    UseInterceptors(UsageTrackingInterceptor),
  )
}
