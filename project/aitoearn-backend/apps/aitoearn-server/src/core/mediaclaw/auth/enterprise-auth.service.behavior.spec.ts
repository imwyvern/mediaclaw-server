import { EnterpriseInviteStatus, UserRole } from '@yikart/mongodb'

import { Types } from 'mongoose'
import { vi } from 'vitest'
import { EnterpriseAuthService } from './enterprise-auth.service'

vi.mock('@yikart/mongodb', () => {
  class EnterpriseInvite {}
  class MediaClawUser {}
  class Organization {}
  class OrganizationEnterpriseProfile {}
  class Subscription {}
  const BillingMode = {
    QUOTA: 'quota',
  }
  const EnterpriseInviteStatus = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
  }
  const McUserType = {
    INDIVIDUAL: 'individual',
    ENTERPRISE: 'enterprise',
  }
  const OrgStatus = {
    TRIAL: 'trial',
    ACTIVE: 'active',
  }
  const OrgType = {
    ENTERPRISE: 'enterprise',
  }
  const SubscriptionPlan = {
    TEAM: 'team',
  }
  const SubscriptionStatus = {
    ACTIVE: 'active',
  }
  const UserRole = {
    SUPER_ADMIN: 'super_admin',
    ENTERPRISE_ADMIN: 'admin',
    OPERATOR: 'editor',
    EMPLOYEE: 'viewer',
    ADMIN: 'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer',
  }

  function normalizeUserRole(role: string | null | undefined, fallback = UserRole.EMPLOYEE) {
    if (!role) {
      return fallback
    }

    if (role === UserRole.SUPER_ADMIN) {
      return UserRole.SUPER_ADMIN
    }

    if (role === UserRole.ENTERPRISE_ADMIN || role === UserRole.ADMIN) {
      return UserRole.ENTERPRISE_ADMIN
    }

    if (role === UserRole.OPERATOR || role === UserRole.EDITOR) {
      return UserRole.OPERATOR
    }

    return UserRole.EMPLOYEE
  }

  function isEnterpriseAssignableRole(role: string | null | undefined) {
    const normalized = normalizeUserRole(role)
    return normalized === UserRole.ENTERPRISE_ADMIN
      || normalized === UserRole.OPERATOR
      || normalized === UserRole.EMPLOYEE
  }

  return {
    BillingMode,
    EnterpriseInvite,
    EnterpriseInviteStatus,
    McUserType,
    MediaClawUser,
    normalizeUserRole,
    isEnterpriseAssignableRole,
    Organization,
    OrganizationEnterpriseProfile,
    OrgStatus,
    OrgType,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
    UserRole,
  }
})

function createQuery<T>(value: T) {
  return {
    exec: vi.fn().mockResolvedValue(value),
  }
}

describe('enterpriseAuthService behavior', () => {
  it('应撤销待处理企业邀请', async () => {
    const orgId = new Types.ObjectId()
    const inviteId = new Types.ObjectId()
    const updatedAt = new Date('2026-04-08T08:00:00.000Z')
    const enterpriseInviteModel = {
      findOne: vi.fn().mockReturnValue(createQuery({
        _id: inviteId,
        orgId,
        phone: '13800138000',
        role: UserRole.OPERATOR,
        status: EnterpriseInviteStatus.PENDING,
      })),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery({
        _id: inviteId,
        orgId,
        phone: '13800138000',
        role: UserRole.OPERATOR,
        status: EnterpriseInviteStatus.REVOKED,
        updatedAt,
      })),
    }
    const service = new EnterpriseAuthService(
      {} as any,
      {} as any,
      {} as any,
      enterpriseInviteModel as any,
      {} as any,
    )

    const result = await service.revokeInvite(orgId.toString(), inviteId.toString())

    expect(result).toMatchObject({
      id: inviteId.toString(),
      orgId: orgId.toString(),
      phone: '13800138000',
      role: UserRole.OPERATOR,
      status: EnterpriseInviteStatus.REVOKED,
      revoked: true,
      updatedAt,
    })
  })
})
