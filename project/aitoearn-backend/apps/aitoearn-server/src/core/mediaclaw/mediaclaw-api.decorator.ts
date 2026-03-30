import { applyDecorators, Controller, UseInterceptors } from '@nestjs/common'
import { UsageTrackingInterceptor } from './usage/usage-tracking.interceptor'

export function MediaClawApiController(path: string | string[]) {
  return applyDecorators(
    Controller(path),
    UseInterceptors(UsageTrackingInterceptor),
  )
}
