import { vi } from 'vitest'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { of, lastValueFrom } from 'rxjs'
import { Types } from 'mongoose'
vi.mock('@yikart/mongodb', () => {
  class ApiKey {}
  class Brand {}
  class PaymentOrder {}
  class Pipeline {}
  class PlatformAccount {}
  class PublishRecord {}
  class VideoPack {}
  class VideoTask {}

  return {
    ApiKey,
    Brand,
    PackStatus: {
      ACTIVE: 'active',
      DEPLETED: 'depleted',
      EXPIRED: 'expired',
      REFUNDED: 'refunded',
    },
    PackType: {
      SINGLE: 'single',
      PACK_10: 'pack_10',
      PACK_30: 'pack_30',
      PACK_100: 'pack_100',
    },
    PaymentMethod: {
      WECHAT_NATIVE: 'wechat_native',
      WECHAT_JSAPI: 'wechat_jsapi',
      ALIPAY: 'alipay',
    },
    PaymentOrder,
    PaymentProductType: {
      VIDEO_PACK: 'video_pack',
      SUBSCRIPTION: 'subscription',
      ADDON: 'addon',
    },
    PaymentStatus: {
      PENDING: 'pending',
      PAID: 'paid',
      FAILED: 'failed',
      REFUNDED: 'refunded',
      EXPIRED: 'expired',
    },
    Pipeline,
    PlatformAccount,
    PlatformAccountPlatform: {
      DOUYIN: 'douyin',
      KUAISHOU: 'kuaishou',
      XIAOHONGSHU: 'xiaohongshu',
      BILIBILI: 'bilibili',
      WECHAT_VIDEO: 'wechat-video',
    },
    PlatformAccountStatus: {
      ACTIVE: 'active',
      EXPIRED: 'expired',
      SUSPENDED: 'suspended',
    },
    PublishRecord,
    UserRole: {
      ADMIN: 'admin',
      VIEWER: 'viewer',
    },
    VideoPack,
    VideoTask,
    VideoTaskStatus: {
      PENDING: 'pending',
      ANALYZING: 'analyzing',
      EDITING: 'editing',
      RENDERING: 'rendering',
      QUALITY_CHECK: 'quality_check',
      GENERATING_COPY: 'generating_copy',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
    },
    VideoTaskType: {
      BRAND_REPLACE: 'brand_replace',
      REMIX: 'remix',
      NEW_CONTENT: 'new_content',
    },
  }
})

import {
  PlatformAccountPlatform,
  PlatformAccountStatus,
  UserRole,
} from '@yikart/mongodb'
import { AuditInterceptor } from '../../apps/aitoearn-server/src/core/mediaclaw/audit/audit.interceptor'
import { MediaClawApiKeyService } from '../../apps/aitoearn-server/src/core/mediaclaw/apikey/apikey.service'
import { PlatformAccountService } from '../../apps/aitoearn-server/src/core/mediaclaw/platform-account/platform-account.service'
import { XorPayService } from '../../apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service'
import { PermissionGuard } from '../../apps/aitoearn-server/src/core/mediaclaw/permission.guard'
import { TaskMgmtService } from '../../apps/aitoearn-server/src/core/mediaclaw/task-mgmt/task-mgmt.service'
import { createChainQuery, createExecQuery } from '../support/query'

describe('MediaClaw Security Audit', () => {
  it('应在审计日志中转义可疑 HTML 并隐藏敏感字段', async () => {
    const auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    }
    const interceptor = new AuditInterceptor(auditService as any)

    const request = {
      method: 'POST',
      route: { path: '/api/v1/platform-accounts' },
      originalUrl: '/api/v1/platform-accounts',
      url: '/api/v1/platform-accounts',
      params: {},
      query: {
        keyword: '<script>alert(1)</script>',
      },
      body: {
        bio: '<img src=x onerror=alert(1)>',
        token: 'secret-token',
      },
      headers: {
        'user-agent': 'vitest',
      },
      ip: '127.0.0.1',
      user: {
        id: 'user-1',
        orgId: 'org-1',
      },
    }
    const response = { statusCode: 200 }
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    }

    await lastValueFrom(interceptor.intercept(context as any, {
      handle: () => of({ success: true }),
    } as any))

    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({
        query: {
          keyword: '&lt;script&gt;alert(1)&lt;/script&gt;',
        },
        body: {
          bio: '&lt;img src=x onerror=alert(1)&gt;',
          token: '[REDACTED]',
        },
      }),
    }))
  })

  it('应拒绝缺少签名令牌的状态变更回调', async () => {
    const service = new XorPayService(
      {} as any,
      {} as any,
      {} as any,
    )

    await expect(service.handleCallback({
      order_id: 'MC-SECURITY-01',
      amount: '199.00',
      status: 'success',
    }, 'invalid-signature')).rejects.toThrow('Invalid callback signature')
  })

  it('应拒绝 NoSQL 注入形式的品牌过滤参数', async () => {
    const service = new TaskMgmtService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    )

    await expect(service.listTasks(
      new Types.ObjectId().toString(),
      { brandId: '{"$ne":null}' } as any,
      { page: 1, limit: 20 },
    )).rejects.toThrow(BadRequestException)
  })

  it('应对平台账户中的敏感凭证执行加密存储', async () => {
    const orgId = new Types.ObjectId().toString()
    const platformAccountModel = {
      findOneAndUpdate: vi.fn((_filter: Record<string, any>, update: Record<string, any>) => createChainQuery({
        _id: new Types.ObjectId(),
        orgId: new Types.ObjectId(orgId),
        platform: PlatformAccountPlatform.DOUYIN,
        accountId: 'acc-1',
        accountName: '主账号',
        avatarUrl: '',
        credentials: update.$set.credentials,
        status: PlatformAccountStatus.ACTIVE,
        metrics: {
          followers: 0,
          totalViews: 0,
          avgEngagement: 0,
        },
        lastSyncedAt: null,
        createdAt: new Date('2026-03-30T00:00:00.000Z'),
        updatedAt: new Date('2026-03-30T00:00:00.000Z'),
      })),
    }
    const service = new PlatformAccountService(
      platformAccountModel as any,
      {} as any,
    )

    const result = await service.addAccount(orgId, PlatformAccountPlatform.DOUYIN, {
      accountId: 'acc-1',
      name: '主账号',
      accessToken: 'plain-secret-token',
      phone: '13800138000',
    })

    expect(result.credentials).toMatchObject({
      algorithm: 'aes-256-cbc',
      iv: expect.any(String),
      encryptedData: expect.any(String),
    })
    expect(JSON.stringify(result.credentials)).not.toContain('plain-secret-token')
    expect(JSON.stringify(result.credentials)).not.toContain('13800138000')
  })

  it('应阻止 API Key 权限越权访问管理员端点', async () => {
    const apiKeyModel = {
      findOne: vi.fn().mockReturnValue(createExecQuery({
        _id: new Types.ObjectId(),
        userId: 'user-1',
        orgId: new Types.ObjectId(),
        permissions: ['video:create'],
        isActive: true,
        expiresAt: null,
      })),
      findByIdAndUpdate: vi.fn().mockReturnValue(createExecQuery(undefined)),
    }
    const apiKeyService = new MediaClawApiKeyService(apiKeyModel as any)
    const apiKeyUser = await apiKeyService.validate('mc_live_boundary_key_123456')

    const guard = new PermissionGuard({
      getAllAndOverride: vi.fn().mockReturnValue([UserRole.ADMIN]),
    } as any)

    const context = {
      getHandler: () => 'handler',
      getClass: () => 'controller',
      switchToHttp: () => ({
        getRequest: () => ({
          user: apiKeyUser,
        }),
      }),
    }

    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException)
  })
})
