import { applyDecorators, Controller, UseGuards, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { UserRole } from '@yikart/mongodb'
import { PermissionGuard, Roles } from './permission.guard'
import { UsageTrackingInterceptor } from './usage/usage-tracking.interceptor'

function resolveTags(path: string | string[]) {
  const paths = Array.isArray(path) ? path : [path]

  for (const candidate of paths) {
    const normalized = candidate.replace(/^\/+|\/+$/g, '')
    const segments = normalized.split('/').filter(Boolean)
    const versionIndex = segments.indexOf('v1')
    const derivedTag = versionIndex >= 0
      ? segments[versionIndex + 1]
      : segments.at(-1)

    if (derivedTag) {
      return [derivedTag]
    }
  }

  return ['mediaclaw']
}

export function MediaClawApiController(path: string | string[]) {
  const tags = resolveTags(path)

  return applyDecorators(
    Controller(path),
    ApiTags(...tags),
    ApiBearerAuth(),
    UseGuards(PermissionGuard, ThrottlerGuard),
    Roles(UserRole.EMPLOYEE),
    Throttle({
      mediaclawPublic: {
        limit: 120,
        ttl: 60_000,
      },
    }),
    UseInterceptors(UsageTrackingInterceptor),
  )
}
