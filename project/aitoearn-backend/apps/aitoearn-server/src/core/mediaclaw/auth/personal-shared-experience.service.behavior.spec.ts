import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonalSharedExperienceService } from './personal-shared-experience.service'

vi.mock('@yikart/mongodb', () => {
  class ClawHostInstance {}
  class MediaClawUser {}
  class VideoPack {}

  return {
    ClawHostInstance,
    ClawHostInstanceStatus: {
      RUNNING: 'running',
    },
    McUserType: {
      INDIVIDUAL: 'individual',
      ENTERPRISE: 'enterprise',
    },
    MediaClawUser,
    PackStatus: {
      ACTIVE: 'active',
    },
    VideoPack,
  }
})

function createQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

function createSharedInstance(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    instanceId: 'shared-demo-1',
    clientName: 'MediaClaw 共享体验实例',
    status: 'running',
    accessUrl: 'https://demo.mediaclaw.ai',
    sharedExperienceConfig: {
      enabled: true,
      displayName: 'MediaClaw 官方体验群',
      welcomeMessage: '发送开始体验即可领取试用任务',
      supportContact: '企微小助手',
      defaultChannel: 'feishu',
      channels: [{
        channel: 'feishu',
        groupName: 'MediaClaw 飞书体验群',
        inviteUrl: 'https://open.feishu.cn/invite/shared-demo',
        chatId: 'oc_chat_001',
        entryKeyword: '开始体验',
      }],
      lastActivatedAt: null,
    },
    ...overrides,
  }
}

describe('personalSharedExperienceService behavior', () => {
  let service: PersonalSharedExperienceService
  let userModel: Record<string, any>
  let videoPackModel: Record<string, any>
  let clawHostInstanceModel: Record<string, any>

  beforeEach(() => {
    userModel = {
      findById: vi.fn(),
      updateOne: vi.fn().mockReturnValue(createQuery({ acknowledged: true })),
    }
    videoPackModel = {
      find: vi.fn(),
    }
    clawHostInstanceModel = {
      find: vi.fn(),
      findOne: vi.fn(),
      updateOne: vi.fn().mockReturnValue(createQuery({ acknowledged: true })),
    }

    service = new PersonalSharedExperienceService(
      userModel as any,
      videoPackModel as any,
      clawHostInstanceModel as any,
    )
  })

  it('应返回可用的共享群体验目录', async () => {
    clawHostInstanceModel.find.mockReturnValue(createQuery([
      createSharedInstance(),
    ]))

    const result = await service.getCatalog()

    expect(result.enabled).toBe(true)
    expect(result.items).toEqual([
      expect.objectContaining({
        instanceId: 'shared-demo-1',
        displayName: 'MediaClaw 官方体验群',
        selectedChannel: expect.objectContaining({
          channel: 'feishu',
          isDefault: true,
        }),
      }),
    ])
  })

  it('应为个人用户激活共享群体验并生成稳定 session', async () => {
    const userId = new Types.ObjectId()
    const user = {
      _id: userId,
      phone: '13800138000',
      name: '测试用户',
      userType: 'individual',
      sharedExperience: {
        instanceId: '',
        sessionId: '',
        channel: '',
        activatedAt: null,
        lastAccessAt: null,
      },
    }
    userModel.findById.mockReturnValue(createQuery(user))
    clawHostInstanceModel.find.mockReturnValue(createQuery([
      createSharedInstance(),
    ]))
    videoPackModel.find.mockReturnValue(createQuery([{
      packType: 'trial_free',
      remainingCredits: 1,
      expiresAt: new Date('2026-04-30T00:00:00.000Z'),
    }]))

    const result = await service.activate(userId.toString(), {
      preferredChannel: 'feishu',
    })

    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      {
        $set: {
          sharedExperience: expect.objectContaining({
            instanceId: 'shared-demo-1',
            channel: 'feishu',
            sessionId: expect.stringMatching(/^mc_shared_/),
          }),
        },
      },
    )
    expect(clawHostInstanceModel.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId) },
      {
        $set: {
          'sharedExperienceConfig.lastActivatedAt': expect.any(Date),
        },
      },
    )
    expect(result.activated).toBe(true)
    expect(result.balance).toEqual(expect.objectContaining({
      totalRemainingCredits: 1,
      trialRemainingCredits: 1,
    }))
    expect(result.entry.selectedChannel).toEqual(expect.objectContaining({
      channel: 'feishu',
    }))
  })
})
