import type { TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { Test } from '@nestjs/testing'
import {
  Brand,
  Invoice,
  MediaClawUser,
  Organization,
  Subscription,
  UserRole,
  VideoTask,
} from '@yikart/mongodb'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EnterpriseAuthService } from '../auth/enterprise-auth.service'
import { OrgMemberAdminService } from '../org/org-member-admin.service'
import { ClientMgmtController } from './client-mgmt.controller'
import { ClientMgmtService } from './client-mgmt.service'

Reflect.defineMetadata('design:paramtypes', [ClientMgmtService], ClientMgmtController)

function createQueryMock<T>(value: T) {
  const query = {
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

function createModelMock(name: string) {
  const defaultDocument = {
    _id: `${name.toLowerCase()}-id`,
    name: `${name} mock`,
    orgId: 'org-1',
    isActive: true,
    billingMode: 'quota',
    type: 'enterprise',
    status: 'active',
    toObject: () => ({
      _id: `${name.toLowerCase()}-id`,
      name: `${name} mock`,
      orgId: 'org-1',
      isActive: true,
      billingMode: 'quota',
      type: 'enterprise',
      status: 'active',
    }),
  }

  return {
    aggregate: vi.fn().mockResolvedValue([]),
    countDocuments: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue(defaultDocument),
    find: vi.fn().mockReturnValue(createQueryMock([])),
    findById: vi.fn().mockReturnValue(createQueryMock(defaultDocument)),
    findOne: vi.fn().mockReturnValue(createQueryMock(defaultDocument)),
    findOneAndUpdate: vi.fn().mockReturnValue(createQueryMock(defaultDocument)),
    updateOne: vi.fn().mockReturnValue(createQueryMock({ modifiedCount: 1 })),
  }
}

describe('clientMgmtService', () => {
  let moduleRef: TestingModule
  let service: ClientMgmtService
  let controller: ClientMgmtController

  const organizationModel = createModelMock(Organization.name)
  const mediaClawUserModel = createModelMock(MediaClawUser.name)
  const brandModel = createModelMock(Brand.name)
  const videoTaskModel = createModelMock(VideoTask.name)
  const subscriptionModel = createModelMock(Subscription.name)
  const invoiceModel = createModelMock(Invoice.name)
  const enterpriseAuthService = {
    createInvite: vi.fn(),
    revokeInvite: vi.fn(),
    listInvitesForOrg: vi.fn().mockResolvedValue([]),
  }
  const orgMemberAdminService = {
    listMembers: vi.fn().mockResolvedValue([]),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [ClientMgmtController],
      providers: [
        ClientMgmtService,
        { provide: getModelToken(Organization.name), useValue: organizationModel },
        { provide: getModelToken(MediaClawUser.name), useValue: mediaClawUserModel },
        { provide: getModelToken(Brand.name), useValue: brandModel },
        { provide: getModelToken(VideoTask.name), useValue: videoTaskModel },
        { provide: getModelToken(Subscription.name), useValue: subscriptionModel },
        { provide: getModelToken(Invoice.name), useValue: invoiceModel },
        { provide: EnterpriseAuthService, useValue: enterpriseAuthService },
        { provide: OrgMemberAdminService, useValue: orgMemberAdminService },
      ],
    }).compile()

    service = moduleRef.get(ClientMgmtService)
    controller = moduleRef.get(ClientMgmtController)
  })

  afterAll(async () => {
    await moduleRef.close()
  })

  it('模块可以完成 bootstrap', () => {
    expect(moduleRef).toBeDefined()
  })

  it('service 可以被注入', () => {
    expect(service).toBeDefined()
  })

  it('controller 可以被注入', () => {
    expect(controller).toBeDefined()
  })

  it('核心方法可调用', () => {
    expect(service.listOrgs).toBeTypeOf('function')
    expect(service.getOrgDetail).toBeTypeOf('function')
    expect(service.inviteMember).toBeTypeOf('function')
  })

  it('controller listOrgs 会标准化分页参数后委托给 service', async () => {
    const listOrgsSpy = vi.spyOn(service, 'listOrgs').mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      limit: 15,
    })

    await controller.listOrgs(undefined, undefined, '测试', '2', '15')

    expect(listOrgsSpy).toHaveBeenCalledWith(
      { status: undefined, type: undefined, keyword: '测试' },
      { page: 2, limit: 15 },
    )

    listOrgsSpy.mockRestore()
  })

  it('controller inviteMember 会透传 orgId、手机号和角色', async () => {
    const inviteSpy = vi.spyOn(service, 'inviteMember').mockResolvedValue({
      success: true,
    } as Awaited<ReturnType<ClientMgmtService['inviteMember']>>)

    await controller.inviteMember('org-1', {
      phone: '13800138000',
      role: UserRole.ENTERPRISE_MEMBER,
    })

    expect(inviteSpy).toHaveBeenCalledWith(
      'org-1',
      '13800138000',
      UserRole.ENTERPRISE_MEMBER,
    )

    inviteSpy.mockRestore()
  })
})
