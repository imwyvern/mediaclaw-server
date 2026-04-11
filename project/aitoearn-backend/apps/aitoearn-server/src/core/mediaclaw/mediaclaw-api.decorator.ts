import { applyDecorators, Controller, Header, SetMetadata, UseGuards, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { API_CONTRACT_METADATA_KEY, API_CONTRACT_TYPES, DEPRECATED_ROUTE_METADATA_KEY } from '@yikart/common'
import { UserRole } from '@yikart/mongodb'
import { PermissionGuard, Roles } from './permission.guard'
import { UsageTrackingInterceptor } from './usage/usage-tracking.interceptor'

const MEDIA_CLAW_STABLE_PREFIX = 'api/v1'
const DEFAULT_MEDIA_CLAW_SUNSET = 'Thu, 31 Dec 2026 23:59:59 GMT'

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

function assertVersionedPath(path: string | string[]) {
  const paths = Array.isArray(path) ? path : [path]

  for (const candidate of paths) {
    const normalized = candidate.replace(/^\/+/, '')
    if (!normalized.startsWith(MEDIA_CLAW_STABLE_PREFIX)) {
      throw new Error(`MediaClawApiController path must start with ${MEDIA_CLAW_STABLE_PREFIX}: ${candidate}`)
    }
  }
}

export function MediaClawApiController(path: string | string[]) {
  assertVersionedPath(path)
  const tags = resolveTags(path)

  return applyDecorators(
    Controller(path),
    SetMetadata(API_CONTRACT_METADATA_KEY, API_CONTRACT_TYPES.MEDIACLAW_V1),
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

export function MediaClawDeprecatedAlias(successorPath: string, options?: { sunset?: string, reason?: string }) {
  const sunset = options?.sunset || DEFAULT_MEDIA_CLAW_SUNSET
  const description = options?.reason
    ? `Deprecated alias. Use ${successorPath} instead. ${options.reason}`
    : `Deprecated alias. Use ${successorPath} instead.`

  return applyDecorators(
    Header('Deprecation', 'true'),
    Header('Sunset', sunset),
    Header('Link', `<${successorPath}>; rel="successor-version"`),
    SetMetadata(DEPRECATED_ROUTE_METADATA_KEY, {
      successorPath,
      sunset,
      reason: options?.reason || '',
    }),
    ApiOperation({
      deprecated: true,
      description,
    }),
  )
}
