import { UserRole } from '@yikart/mongodb'

import { Types } from 'mongoose'
import { vi } from 'vitest'
import { ClientMgmtService } from './client-mgmt.service'

vi.mock('@yikart/mongodb', () => {
  class Brand {}
  class Invoice {}
  class MediaClawUser {}
  class Organization {}
  class Subscription {}
  class VideoTask {}
  const UserRole = {
    SUPER_ADMIN: 'super_admin',
    ENTERPRISE_ADMIN: 'admin',
    OPERATOR: 'editor',
    EMPLOYEE: 'viewer',
    ADMIN: 'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer',
  }
  const OrgStatus = {
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    TRIAL: 'trial',
  }
  const OrgType = {
    INDIVIDUAL: 'individual',
    TEAM: 'team',
    PROFESSIONAL: 'professional',
    ENTERPRISE: 'enterprise',
  }
  const SubscriptionStatus = {
    ACTIVE: 'active',
    PAST_DUE: 'past_due',
  }
  const VideoTaskStatus = {
    DRAFT: 'draft',
    PENDING: 'pending',
    ANALYZING: 'analyzing',
    EDITING: 'editing',
    RENDERING: 'rendering',
    QUALITY_CHECK: 'quality_check',
    GENERATING_COPY: 'generating_copy',
    COMPLETED: 'completed',
    PENDING_REVIEW: 'pending_review',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    PUBLISHED: 'published',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
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

  return {
    Brand,
    Invoice,
    MediaClawUser,
    Organization,
    Subscription,
    VideoTask,
    OrgStatus,
    OrgType,
    SubscriptionStatus,
    UserRole,
    VideoTaskStatus,
    normalizeUserRole,
  }
})

describe('clientMgmtService behavior', () => {
  it('应支持管理员查看和撤销待处理邀请', async () => {
    const orgId = new Types.ObjectId().toString()
    const organizationModel = {
      exists: vi.fn().mockResolvedValue(true),
    }
    const enterpriseAuthService = {
      listPendingInvites: vi.fn().mockResolvedValue([
        {
          id: 'invite-1',
          phone: '13800138000',
          role: UserRole.OPERATOR,
        },
      ]),
      inviteByPhone: vi.fn().mockResolvedValue({
        id: 'invite-2',
        phone: '13800138001',
        role: UserRole.EMPLOYEE,
      }),
      revokeInvite: vi.fn().mockResolvedValue({
        id: 'invite-1',
        revoked: true,
      }),
    }
    const service = new ClientMgmtService(
      organizationModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      enterpriseAuthService as any,
      {} as any,
    )

    await expect(service.listPendingInvites(orgId)).resolves.toEqual([
      expect.objectContaining({
        id: 'invite-1',
      }),
    ])
    await expect(
      service.inviteMember(orgId, '13800138001', UserRole.EMPLOYEE),
    ).resolves.toMatchObject({
      id: 'invite-2',
    })
    await expect(service.revokeInvite(orgId, 'invite-1')).resolves.toMatchObject({
      revoked: true,
    })

    expect(enterpriseAuthService.listPendingInvites).toHaveBeenCalledWith(orgId)
    expect(enterpriseAuthService.inviteByPhone).toHaveBeenCalledWith(
      orgId,
      '13800138001',
      UserRole.EMPLOYEE,
    )
    expect(enterpriseAuthService.revokeInvite).toHaveBeenCalledWith(orgId, 'invite-1')
  })
})
