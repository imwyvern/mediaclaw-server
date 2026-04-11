import { UserRole } from '@yikart/mongodb'

import { Types } from 'mongoose'
import { vi } from 'vitest'
import { ClientMgmtService } from './client-mgmt.service'

vi.mock('@yikart/mongodb', () => {
  class Brand {}
  class ClawHostInstance {}
  class Invoice {}
  class MediaClawUser {}
  class Organization {}
  class SkillMarketplaceEntry {}
  class Subscription {}
  class VideoTask {}
  const ClawHostDeploymentMode = {
    MANAGED: 'managed',
    BYOC: 'byoc',
  }
  const ClawHostInstanceStatus = {
    CREATING: 'creating',
    PENDING_MANUAL_SETUP: 'pending_manual_setup',
    RUNNING: 'running',
    STOPPED: 'stopped',
    UPGRADING: 'upgrading',
    ERROR: 'error',
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
  const SkillMarketplaceEntryStatus = {
    DRAFT: 'draft',
    PUBLISHED: 'published',
    ARCHIVED: 'archived',
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
    ClawHostDeploymentMode,
    ClawHostInstance,
    ClawHostInstanceStatus,
    Invoice,
    MediaClawUser,
    Organization,
    SkillMarketplaceEntry,
    SkillMarketplaceEntryStatus,
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
  it('应对机构搜索关键字做正则转义', async () => {
    const query = {
      sort: vi.fn(),
      skip: vi.fn(),
      limit: vi.fn(),
      lean: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    }
    query.sort.mockReturnValue(query)
    query.skip.mockReturnValue(query)
    query.limit.mockReturnValue(query)
    query.lean.mockReturnValue(query)

    const organizationModel = {
      find: vi.fn().mockReturnValue(query),
      countDocuments: vi.fn().mockResolvedValue(0),
    }
    const service = new ClientMgmtService(
      organizationModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    )

    await service.listOrgs({ keyword: '3C+(test).*' }, { page: 1, limit: 20 })

    expect(organizationModel.find).toHaveBeenCalledWith({
      $or: [
        { name: { $regex: '3C\\+\\(test\\)\\.\\*', $options: 'i' } },
        { contactName: { $regex: '3C\\+\\(test\\)\\.\\*', $options: 'i' } },
        { contactPhone: { $regex: '3C\\+\\(test\\)\\.\\*', $options: 'i' } },
        { contactEmail: { $regex: '3C\\+\\(test\\)\\.\\*', $options: 'i' } },
      ],
    })
  })

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
