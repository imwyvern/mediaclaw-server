import { Types } from 'mongoose'
import { ConversationUsageService } from './conversation-usage.service'

vi.mock('@yikart/mongodb', () => ({
  BillingMode: {
    SUBSCRIPTION: 'subscription',
  },
  ConversationIntent: {
    CHAT: 'chat',
  },
  ConversationUsage: class ConversationUsage {},
  NotificationEvent: {
    TOKEN_QUOTA_WARNING: 'token.quota_warning',
    TOKEN_QUOTA_EXCEEDED: 'token.quota_exceeded',
  },
  Organization: class Organization {},
  OrgType: {
    ENTERPRISE: 'enterprise',
  },
  Subscription: class Subscription {},
  SubscriptionPlan: {
    TEAM: 'team',
    PRO: 'pro',
    FLAGSHIP: 'flagship',
  },
  SubscriptionStatus: {
    ACTIVE: 'active',
  },
}))

describe('conversationUsageService behavior', () => {
  it('应在额度预警时同时触发通知和 webhook', async () => {
    const organizationId = new Types.ObjectId()
    const organizationModel = {
      findByIdAndUpdate: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      }),
    }
    const notificationService = {
      sendNotification: vi.fn().mockResolvedValue(undefined),
    }
    const webhookService = {
      trigger: vi.fn().mockResolvedValue(undefined),
    }

    const service = new ConversationUsageService(
      {} as any,
      organizationModel as any,
      {} as any,
      notificationService as any,
      webhookService as any,
    )

    await (service as any).maybeNotifyQuota(
      {
        _id: organizationId,
        settings: {},
      },
      {
        period: {
          startAt: '2026-04-01T00:00:00.000Z',
        },
        quota: {
          isUnlimited: false,
          total: 1000,
          used: 820,
          remaining: 180,
          usageRate: 82,
          warningLevel: 'warning',
        },
      },
    )

    expect(notificationService.sendNotification).toHaveBeenCalledWith(
      organizationId.toString(),
      'token.quota_warning',
      expect.objectContaining({
        orgId: organizationId.toString(),
        usageRate: 82,
      }),
    )
    expect(webhookService.trigger).toHaveBeenCalledWith(
      'token.quota_warning',
      expect.objectContaining({
        orgId: organizationId.toString(),
        usageRate: 82,
      }),
    )
  })
})
