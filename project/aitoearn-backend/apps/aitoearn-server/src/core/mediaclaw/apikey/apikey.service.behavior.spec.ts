import { describe, expect, it, vi } from 'vitest'
import { MediaClawApiKeyService } from './apikey.service'

describe('mediaClawApiKeyService behavior', () => {
  it('list 应返回脱敏后的 key 列表', async () => {
    const exec = vi.fn().mockResolvedValue([
      {
        _id: { toString: () => 'api-key-1' },
        createdAt: new Date('2026-04-09T00:00:00.000Z'),
        expiresAt: null,
        isActive: true,
        lastUsedAt: new Date('2026-04-09T01:00:00.000Z'),
        name: 'Demo Key',
        permissions: ['read'],
        prefix: 'mc_live_abcd1234',
        role: 'employee',
      },
    ])

    const sort = vi.fn().mockReturnValue({ exec })
    const apiKeyModel = {
      find: vi.fn().mockReturnValue({ sort }),
    }

    const service = new MediaClawApiKeyService(apiKeyModel as any, {} as any)
    const result = await service.list('user-1')

    expect(apiKeyModel.find).toHaveBeenCalledWith({
      userId: 'user-1',
      isActive: true,
    })
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 })
    expect(result).toEqual([
      expect.objectContaining({
        id: 'api-key-1',
        prefix: 'mc_live_abcd1234',
        maskedKey: 'mc_live_************************1234',
        name: 'Demo Key',
        permissions: ['read'],
        isActive: true,
      }),
    ])
    expect(result[0]).not.toHaveProperty('key')
  })

  it('validateOwnedKey 应兼容 customer scoped key 格式', async () => {
    const rawKey = 'mc_beautybrand_abc123def456'
    const record = {
      _id: { toString: () => 'api-key-2' },
      userId: 'user-1',
      orgId: { toString: () => 'org-1' },
      permissions: ['read'],
      role: 'employee',
      isActive: true,
      expiresAt: null,
      lastUsedAt: null,
      prefix: 'mc_beautybrand_abc123de',
      name: 'Scoped Key',
      createdAt: new Date('2026-04-09T00:00:00.000Z'),
    }
    const findOne = vi.fn()
      .mockReturnValueOnce({
        exec: vi.fn().mockResolvedValue(record),
      })
      .mockReturnValueOnce({
        exec: vi.fn().mockResolvedValue(record),
      })
    const apiKeyModel = {
      findOne,
      findByIdAndUpdate: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(record),
      }),
    }

    const service = new MediaClawApiKeyService(apiKeyModel as any, {} as any)
    const result = await service.validateOwnedKey('user-1', { key: rawKey })

    expect(result).toEqual(
      expect.objectContaining({
        valid: true,
        message: 'API key is active',
      }),
    )
    expect(findOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 'user-1',
      }),
    )
  })
})
