import {
  BillingMode,
  OrgApiKeyProvider,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelResolverService } from './model-resolver.service'

function createExecQuery<T>(value: T) {
  return {
    exec: vi.fn().mockResolvedValue(value),
  }
}

function createLeanExecQuery<T>(value: T) {
  return {
    lean: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(value),
    }),
  }
}

describe('modelResolverService', () => {
  let service: ModelResolverService
  let organizationModel: Record<string, any>
  let pipelineModel: Record<string, any>
  let configService: Record<string, any>

  beforeEach(() => {
    organizationModel = {
      findById: vi.fn(),
    }
    pipelineModel = {
      findOne: vi.fn(),
    }
    configService = {
      getString: vi.fn().mockReturnValue(''),
      has: vi.fn().mockReturnValue(false),
    }

    service = new ModelResolverService(
      organizationModel as any,
      pipelineModel as any,
      configService as any,
    )
  })

  it('应校验组织模型偏好并在空字符串时回落到默认值', async () => {
    const orgId = new Types.ObjectId().toString()
    organizationModel.findById.mockReturnValue(createExecQuery({
      _id: new Types.ObjectId(orgId),
      billingMode: BillingMode.QUOTA,
      modelPreferences: {
        chat: 'deepseek-v3',
        copy: 'deepseek-v3',
      },
      apiKeys: {
        [OrgApiKeyProvider.OPENAI]: {
          encryptedKey: 'encrypted-openai-key',
        },
      },
    }))

    const result = await service.validateOrganizationPreferences(orgId, {
      copy: 'gpt-4o',
      analysis: '   ',
    })

    expect(result).toMatchObject({
      chat: 'deepseek-v3',
      copy: 'gpt-4o',
      analysis: 'deepseek-v3',
    })
  })

  it('应拒绝当前不可用的组织模型偏好', async () => {
    const orgId = new Types.ObjectId().toString()
    organizationModel.findById.mockReturnValue(createExecQuery({
      _id: new Types.ObjectId(orgId),
      billingMode: BillingMode.QUOTA,
      modelPreferences: {},
      apiKeys: {},
    }))

    await expect(service.validateOrganizationPreferences(orgId, {
      copy: 'gpt-4o',
    })).rejects.toThrow('当前不可用')
  })

  it('应优先返回可用的 pipeline override 模型', async () => {
    const orgId = new Types.ObjectId().toString()
    const pipelineId = new Types.ObjectId().toString()
    organizationModel.findById.mockReturnValue(createExecQuery({
      _id: new Types.ObjectId(orgId),
      billingMode: BillingMode.QUOTA,
      modelPreferences: {
        copy: 'deepseek-v3',
      },
      apiKeys: {
        [OrgApiKeyProvider.OPENAI]: {
          encryptedKey: 'encrypted-openai-key',
        },
      },
    }))
    pipelineModel.findOne.mockReturnValue(createLeanExecQuery({
      modelOverrides: {
        copy: 'gpt-4o',
      },
    }))

    const resolved = await service.resolveCapability(orgId, 'copy', pipelineId)

    expect(resolved).toMatchObject({
      id: 'gpt-4o',
      provider: OrgApiKeyProvider.OPENAI,
      source: 'pipeline',
      available: true,
    })
  })
})
