import { McUserType, UserRole } from '@yikart/mongodb'

import { Types } from 'mongoose'
import { vi } from 'vitest'
import { OrgMemberAdminService } from './org-member-admin.service'

vi.mock('@yikart/mongodb', () => {
  class MediaClawUser {}
  class Organization {}
  const UserRole = {
    SUPER_ADMIN: 'super_admin',
    ENTERPRISE_ADMIN: 'admin',
    OPERATOR: 'editor',
    EMPLOYEE: 'viewer',
    ADMIN: 'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer',
  }
  const McUserType = {
    INDIVIDUAL: 'individual',
    ENTERPRISE: 'enterprise',
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
    MediaClawUser,
    Organization,
    UserRole,
    McUserType,
    normalizeUserRole,
  }
})

function createQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('orgMemberAdminService behavior', () => {
  let organizationModel: Record<string, any>
  let mediaClawUserModel: Record<string, any>
  let service: OrgMemberAdminService

  beforeEach(() => {
    organizationModel = {
      exists: vi.fn().mockResolvedValue(true),
    }
    mediaClawUserModel = {
      find: vi.fn(),
      findOne: vi.fn(),
    }

    service = new OrgMemberAdminService(
      organizationModel as any,
      mediaClawUserModel as any,
    )
  })

  it('应返回组织成员列表并规范化角色', async () => {
    const orgId = new Types.ObjectId()
    const memberId = new Types.ObjectId()
    mediaClawUserModel.find.mockReturnValue(createQuery([
      {
        _id: memberId,
        phone: '13800138000',
        email: 'member@example.com',
        name: '小王',
        role: UserRole.EMPLOYEE,
        userType: McUserType.ENTERPRISE,
        isActive: true,
        orgMemberships: [
          {
            orgId,
            role: UserRole.OPERATOR,
            joinedAt: new Date('2026-04-01T00:00:00.000Z'),
          },
        ],
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-02T00:00:00.000Z'),
      },
    ]))

    const result = await service.listMembers(orgId.toString())

    expect(result).toEqual([
      expect.objectContaining({
        id: memberId.toString(),
        orgId: orgId.toString(),
        role: UserRole.OPERATOR,
        name: '小王',
      }),
    ])
  })

  it('应更新成员在当前组织中的角色', async () => {
    const orgId = new Types.ObjectId()
    const memberId = new Types.ObjectId()
    const save = vi.fn().mockResolvedValue(undefined)
    mediaClawUserModel.findOne.mockReturnValue(createQuery({
      _id: memberId,
      orgId,
      role: UserRole.EMPLOYEE,
      orgMemberships: [
        {
          orgId,
          role: UserRole.EMPLOYEE,
          joinedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      ],
      updatedAt: new Date('2026-04-02T00:00:00.000Z'),
      save,
    }))

    const result = await service.updateMemberRole(
      orgId.toString(),
      memberId.toString(),
      UserRole.OPERATOR,
    )

    expect(save).toHaveBeenCalled()
    expect(result).toMatchObject({
      id: memberId.toString(),
      role: UserRole.OPERATOR,
    })
  })

  it('应在移除最后一个组织归属后回退为个人用户', async () => {
    const orgId = new Types.ObjectId()
    const memberId = new Types.ObjectId()
    const save = vi.fn().mockResolvedValue(undefined)
    const member = {
      _id: memberId,
      orgId,
      role: UserRole.OPERATOR,
      userType: McUserType.ENTERPRISE,
      orgMemberships: [
        {
          orgId,
          role: UserRole.OPERATOR,
          joinedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      ],
      save,
    }
    mediaClawUserModel.findOne.mockReturnValue(createQuery(member))

    const result = await service.removeMember(orgId.toString(), memberId.toString())

    expect(save).toHaveBeenCalled()
    expect(member.orgMemberships).toEqual([])
    expect(member.orgId).toBeNull()
    expect(member.userType).toBe(McUserType.INDIVIDUAL)
    expect(member.role).toBe(UserRole.EMPLOYEE)
    expect(result).toEqual({
      id: memberId.toString(),
      removed: true,
    })
  })
})
