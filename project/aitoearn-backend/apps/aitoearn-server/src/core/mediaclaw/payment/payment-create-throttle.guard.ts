import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

@Injectable()
export class PaymentCreateThrottleGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const user = req['user']
    return user?.id || req['ip'] || req['ips']?.[0] || req['socket']?.remoteAddress || 'anonymous'
  }
}
