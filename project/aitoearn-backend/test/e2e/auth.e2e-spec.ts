import { vi } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import { Types } from 'mongoose'
vi.mock('@yikart/mongodb', () => {
  class MediaClawUser {}
  class VideoPack {}
  class Organization {}
  class Subscription {}

  return {
    BillingMode: {
      QUOTA: 'quota',
    },
    McUserType: {
      INDIVIDUAL: 'individual',
      ENTERPRISE: 'enterprise',
    },
    MediaClawUser,
    OrgStatus: {
      TRIAL: 'trial',
    },
    OrgType: {
      ENTERPRISE: 'enterprise',
    },
    Organization,
    Subscription,
    SubscriptionPlan: {
      TEAM: 'team',
    },
    SubscriptionStatus: {
      ACTIVE: 'active',
    },
    UserRole: {
      ADMIN: 'admin',
      VIEWER: 'viewer',
    },
    VideoPack,
  }
})

import {
  BillingMode,
  McUserType,
  OrgStatus,
  OrgType,
  SubscriptionPlan,
  SubscriptionStatus,
  UserRole,
} from '@yikart/mongodb'
import { EnterpriseAuthService } from '../../apps/aitoearn-server/src/core/mediaclaw/auth/enterprise-auth.service'
import { McAuthService } from '../../apps/aitoearn-server/src/core/mediaclaw/auth/auth.service'
import { PermissionGuard } from '../../apps/aitoearn-server/src/core/mediaclaw/permission.guard'
import { createExecQuery } from '../support/query'

function createUserDocument(overrides: Record<string, unknown> = {}) {
  const data = {
    _id: new Types.ObjectId(),
    phone: '13800138000',
    name: '测试用户',
    role: UserRole.ADMIN,
    orgId: null,
    userType: McUserType.INDIVIDUAL,
    orgMemberships: [],
    isActive: true,
    avatarUrl: '',
    lastLoginAt: new Date('2026-03-30T08:00:00.000Z'),
    ...overrides,
  }

  return {
    ...data,
    toObject: () => ({ ...data }),
  }
}

function createOrganizationDocument(overrides: Record<string, unknown> = {}) {
  const data = {
    _id: new Types.ObjectId(),
    name: '测试企业',
    type: OrgType.ENTERPRISE,
    status: OrgStatus.TRIAL,
    billingMode: BillingMode.QUOTA,
    contactName: '张三',
    contactPhone: '13800138000',
    contactEmail: 'ops@example.com',
    monthlyQuota: 80,
    monthlyUsed: 0,
    subscriptionExpiresAt: new Date('2026-04-13T00:00:00.000Z'),
    ...overrides,
  }

  return {
    ...data,
    toObject: () => ({ ...data }),
  }
}

function createSubscriptionDocument(orgId: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  const data = {
    _id: new Types.ObjectId(),
    orgId,
    plan: SubscriptionPlan.TEAM,
    status: SubscriptionStatus.ACTIVE,
    billingMode: BillingMode.QUOTA,
    monthlyFeeCents: 0,
    perVideoCents: 0,
    monthlyQuota: 80,
    monthlyUsed: 0,
    currentPeriodStart: new Date('2026-03-30T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-04-13T00:00:00.000Z'),
    autoRenew: false,
    ...overrides,
  }

  return {
    ...data,
    toObject: () => ({ ...data }),
  }
}

describe('MediaClaw Auth E2E', () => {
  it('应完成短信登录流并创建试用视频包', async () => {
    const userModel = {
      findOne: vi.fn().mockReturnValue(createExecQuery(null)),
      create: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    const videoPackModel = {
      create: vi.fn().mockResolvedValue(undefined),
    }
    const jwtService = {
      sign: vi.fn().mockImplementation((payload: { id: string }, options?: { expiresIn?: string }) =>
        `${payload.id}:${options?.expiresIn || 'na'}`),
      verify: vi.fn(),
    }

    const createdUser = createUserDocument()
    userModel.create.mockResolvedValue(createdUser)

    const service = new McAuthService(
      userModel as any,
      videoPackModel as any,
      jwtService as any,
    )

    const phone = '13800138000'
    await expect(service.sendSmsCode(phone)).resolves.toEqual({
      success: true,
      message: 'Code sent',
    })

    const code = (service as any).otpStore.get(phone)?.code as string
    const result = await service.verifySmsCode(phone, code)

    expect(result.isNewUser).toBe(true)
    expect(result.accessToken).toBe(`${createdUser._id.toString()}:2h`)
    expect(result.refreshToken).toBe(`${createdUser._id.toString()}:7d`)
    expect(videoPackModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: createdUser._id.toString(),
      totalCredits: 1,
      remainingCredits: 1,
      status: 'active',
    }))
  })

  it('应完成企业注册并绑定管理员身份', async () => {
    const organization = createOrganizationDocument()
    const subscription = createSubscriptionDocument(organization._id)
    const adminUser = createUserDocument({
      userType: McUserType.ENTERPRISE,
      name: '企业管理员',
    })
    const updatedUser = createUserDocument({
      _id: adminUser._id,
      orgId: organization._id,
      userType: McUserType.ENTERPRISE,
      role: UserRole.ADMIN,
      orgMemberships: [
        {
          orgId: organization._id,
          role: UserRole.ADMIN,
          joinedAt: new Date('2026-03-30T00:00:00.000Z'),
        },
      ],
    })

    const userModel = {
      findOne: vi.fn().mockReturnValue(createExecQuery(null)),
      create: vi.fn().mockResolvedValue(adminUser),
      findByIdAndUpdate: vi.fn().mockReturnValue(createExecQuery(updatedUser)),
    }
    const organizationModel = {
      create: vi.fn().mockResolvedValue(organization),
    }
    const subscriptionModel = {
      create: vi.fn().mockResolvedValue(subscription),
    }
    const authService = {
      validatePhoneNumber: vi.fn(),
      buildAuthResult: vi.fn().mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: updatedUser._id.toString(),
          role: UserRole.ADMIN,
        },
        isNewUser: true,
      }),
    }

    const service = new EnterpriseAuthService(
      userModel as any,
      organizationModel as any,
      subscriptionModel as any,
      authService as any,
    )

    const result = await service.registerEnterprise({
      orgName: '测试企业',
      adminPhone: '13800138000',
      adminName: '张三',
      contactEmail: 'ops@example.com',
      monthlyQuota: 80,
    })

    expect(authService.validatePhoneNumber).toHaveBeenCalledWith('13800138000')
    expect(result.organization).toMatchObject({
      id: organization._id.toString(),
      name: '测试企业',
      status: OrgStatus.TRIAL,
    })
    expect(result.subscription).toMatchObject({
      orgId: organization._id.toString(),
      plan: SubscriptionPlan.TEAM,
      monthlyQuota: 80,
    })
    expect(result.user).toMatchObject({
      id: updatedUser._id.toString(),
      role: UserRole.ADMIN,
    })
  })

  it('应刷新 JWT 并返回新的访问令牌', async () => {
    const activeUser = createUserDocument({
      orgId: new Types.ObjectId(),
      userType: McUserType.ENTERPRISE,
    })
    const userModel = {
      findById: vi.fn().mockReturnValue(createExecQuery(activeUser)),
    }
    const videoPackModel = {
      create: vi.fn(),
    }
    const jwtService = {
      verify: vi.fn().mockReturnValue({
        id: activeUser._id.toString(),
      }),
      sign: vi.fn().mockImplementation((payload: { id: string }, options?: { expiresIn?: string }) =>
        `refreshed:${payload.id}:${options?.expiresIn || 'na'}`),
    }

    const service = new McAuthService(
      userModel as any,
      videoPackModel as any,
      jwtService as any,
    )

    const result = await service.refreshToken('refresh-token')
    expect(result).toEqual({
      accessToken: `refreshed:${activeUser._id.toString()}:2h`,
      refreshToken: `refreshed:${activeUser._id.toString()}:7d`,
    })
  })

  it('应执行基于角色的访问控制', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue([UserRole.ADMIN]),
    }
    const guard = new PermissionGuard(reflector as any)

    const viewerContext = {
      getHandler: () => 'handler',
      getClass: () => 'controller',
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: 'viewer-1',
            role: UserRole.VIEWER,
          },
        }),
      }),
    }
    const adminContext = {
      getHandler: () => 'handler',
      getClass: () => 'controller',
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: 'admin-1',
            role: UserRole.ADMIN,
          },
        }),
      }),
    }

    expect(() => guard.canActivate(viewerContext as any)).toThrow(ForbiddenException)
    expect(guard.canActivate(adminContext as any)).toBe(true)
  })
})
