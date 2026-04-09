import { NotificationEvent, OrgApiKeyProvider } from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ByokService } from './byok.service'

describe('byokService', () => {
  let service: ByokService
  let organizationModel: Record<string, any>
  let configService: Record<string, any>
  let notificationService: Record<string, any>

  beforeEach(() => {
    process.env['BYOK_ENCRYPTION_KEY'] = '12345678901234567890123456789012'
    organizationModel = {
      findById: vi.fn(),
    }
    configService = {
      getString: vi.fn(),
    }
    notificationService = {
      send: vi.fn().mockResolvedValue(undefined),
    }

    service = new ByokService(
      organizationModel as any,
      configService as any,
      notificationService as any,
    )
  })

  it('应在运行时校验失败后回退到平台 key 并通知管理员', async () => {
    const orgId = new Types.ObjectId().toString()
    const encryptedKey = (service as any).encryptKey('customer-key-1234567890')
    const save = vi.fn().mockResolvedValue(undefined)
    const organization = {
      _id: new Types.ObjectId(orgId),
      apiKeys: {
        [OrgApiKeyProvider.GEMINI]: {
          encryptedKey,
          addedAt: new Date('2026-04-01T00:00:00.000Z'),
          isValid: true,
          lastValidatedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      },
      set: vi.fn(function set(key: string, value: Record<string, unknown>) {
        ;(this as any)[key] = value
      }),
      save,
    }

    organizationModel.findById.mockReturnValue({
      exec: vi.fn().mockResolvedValue(organization),
    })
    configService.getString.mockReturnValue('platform-gemini-key')
    vi.spyOn(service as any, 'safeValidateKey').mockResolvedValue({
      isValid: false,
      lastValidatedAt: new Date('2026-04-09T00:00:00.000Z'),
      message: 'Gemini quota exhausted',
    })

    const resolved = await service.getProviderRuntimeKey(orgId, OrgApiKeyProvider.GEMINI)

    expect(resolved).toBe('platform-gemini-key')
    expect(save).toHaveBeenCalled()
    expect(organization.apiKeys[OrgApiKeyProvider.GEMINI]).toEqual(expect.objectContaining({
      isValid: false,
    }))
    expect(notificationService.send).toHaveBeenCalledWith(
      orgId,
      NotificationEvent.TASK_FAILED,
      expect.objectContaining({
        type: 'byok_fallback',
        provider: OrgApiKeyProvider.GEMINI,
        reason: 'Gemini quota exhausted',
        fallbackAvailable: true,
      }),
    )
  })

  it('应在轮换 key 时重置 addedAt 并更新校验状态', async () => {
    const orgId = new Types.ObjectId().toString()
    const save = vi.fn().mockResolvedValue(undefined)
    const organization = {
      _id: new Types.ObjectId(orgId),
      apiKeys: {
        [OrgApiKeyProvider.DEEPSEEK]: {
          encryptedKey: (service as any).encryptKey('old-key-123456789012'),
          addedAt: new Date('2026-04-01T00:00:00.000Z'),
          isValid: true,
          lastValidatedAt: new Date('2026-04-01T00:00:00.000Z'),
        },
      },
      set: vi.fn(function set(key: string, value: Record<string, unknown>) {
        ;(this as any)[key] = value
      }),
      save,
    }

    organizationModel.findById.mockReturnValue({
      exec: vi.fn().mockResolvedValue(organization),
    })
    vi.spyOn(service as any, 'safeValidateKey').mockResolvedValue({
      isValid: true,
      lastValidatedAt: new Date('2026-04-09T00:00:00.000Z'),
      message: 'DeepSeek key validated',
    })

    const result = await service.rotateApiKey(
      orgId,
      OrgApiKeyProvider.DEEPSEEK,
      'new-key-1234567890123456',
      true,
    )

    expect(save).toHaveBeenCalled()
    expect(result.key).toEqual(expect.objectContaining({
      provider: OrgApiKeyProvider.DEEPSEEK,
      isValid: true,
      validationMessage: 'DeepSeek key validated',
    }))
    expect(organization.apiKeys[OrgApiKeyProvider.DEEPSEEK].addedAt.getTime()).toBeGreaterThan(
      new Date('2026-04-01T00:00:00.000Z').getTime(),
    )
  })
})
