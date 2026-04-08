import { UserRole } from '@yikart/mongodb'
import { vi } from 'vitest'
import { OrgService } from './org.service'

describe('orgService behavior', () => {
  it('应委托企业邀请与角色管理能力', async () => {
    const orgMemberAdminService = {
      updateMemberRole: vi.fn().mockResolvedValue({
        id: 'user-1',
        role: UserRole.OPERATOR,
      }),
    }
    const enterpriseAuthService = {
      inviteByPhone: vi.fn().mockResolvedValue({
        id: 'invite-1',
        phone: '13800138000',
      }),
      listPendingInvites: vi.fn().mockResolvedValue([{ id: 'invite-1' }]),
      revokeInvite: vi.fn().mockResolvedValue({
        id: 'invite-1',
        revoked: true,
      }),
    }
    const service = new OrgService(
      {} as any,
      {} as any,
      orgMemberAdminService as any,
      enterpriseAuthService as any,
    )

    await expect(
      service.inviteMember('org-1', '13800138000', UserRole.OPERATOR, 'admin-1'),
    ).resolves.toMatchObject({
      id: 'invite-1',
    })
    await expect(service.listPendingInvites('org-1')).resolves.toEqual([{ id: 'invite-1' }])
    await expect(
      service.updateMemberRole('org-1', 'user-1', UserRole.OPERATOR),
    ).resolves.toMatchObject({
      role: UserRole.OPERATOR,
    })
    await expect(service.revokeInvite('org-1', 'invite-1')).resolves.toMatchObject({
      revoked: true,
    })

    expect(enterpriseAuthService.inviteByPhone).toHaveBeenCalledWith(
      'org-1',
      '13800138000',
      UserRole.OPERATOR,
      'admin-1',
    )
    expect(orgMemberAdminService.updateMemberRole).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      UserRole.OPERATOR,
    )
    expect(enterpriseAuthService.revokeInvite).toHaveBeenCalledWith('org-1', 'invite-1')
  })
})
