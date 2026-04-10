import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OssLifecycleClientFactory } from './oss-lifecycle-client.factory'
import { StorageLifecycleService } from './storage-lifecycle.service'

describe('storageLifecycleService behavior', () => {
  let configService: Record<string, any>
  let lifecycleClientFactory: OssLifecycleClientFactory
  let putBucketLifecycle: ReturnType<typeof vi.fn>
  let getBucketLifecycle: ReturnType<typeof vi.fn>
  let service: StorageLifecycleService

  beforeEach(() => {
    putBucketLifecycle = vi.fn().mockResolvedValue({ status: 200 })
    getBucketLifecycle = vi.fn().mockImplementation(async (_bucket: string) => ({
      rules: [
        {
          id: 'mediaclaw-backup-daily-retention',
          prefix: 'backups/mongodb/daily/',
          status: 'Enabled',
          expiration: {
            days: '30',
          },
          abortMultipartUpload: {
            days: '7',
          },
        },
        {
          id: 'mediaclaw-video-transition-ia',
          prefix: 'videos/',
          status: 'Enabled',
          transition: {
            days: '365',
            storageClass: 'IA',
          },
          abortMultipartUpload: {
            days: '7',
          },
        },
      ],
    }))
    lifecycleClientFactory = {
      create: vi.fn(() => ({
        putBucketLifecycle,
        getBucketLifecycle,
      })),
    } as any
    configService = {
      getNumber: vi.fn((key: string | string[], fallback: number) => {
        const normalizedKey = Array.isArray(key) ? key[0] : key
        if (normalizedKey === 'MEDIACLAW_OSS_VIDEO_TRANSITION_DAYS') {
          return 365
        }
        if (normalizedKey === 'MEDIACLAW_BACKUP_RETENTION_DAYS') {
          return 30
        }
        return fallback
      }),
      getString: vi.fn((key: string | string[], fallback = '') => {
        const normalizedKeys = Array.isArray(key) ? key : [key]
        if (normalizedKeys.includes('BACKUP_BUCKET_URL')) {
          return 'oss://mediaclaw-archive/backups/mongodb'
        }
        if (normalizedKeys.includes('ASSETS_CONFIG')) {
          return JSON.stringify({
            provider: 'ali-oss',
            bucket: 'mediaclaw-archive',
            region: 'oss-cn-hangzhou',
          })
        }
        if (normalizedKeys.includes('MEDIACLAW_OSS_ACCESS_KEY_ID')) {
          return 'oss-key'
        }
        if (normalizedKeys.includes('MEDIACLAW_OSS_ACCESS_KEY_SECRET')) {
          return 'oss-secret'
        }
        if (normalizedKeys.includes('MEDIACLAW_OSS_REGION')) {
          return 'oss-cn-hangzhou'
        }
        if (normalizedKeys.includes('MEDIACLAW_OSS_VIDEO_PREFIX')) {
          return 'videos/'
        }
        return fallback
      }),
    }

    service = new StorageLifecycleService(
      configService as any,
      lifecycleClientFactory,
    )
  })

  it('应同步并校验 backup 与 video 生命周期规则', async () => {
    const result = await service.syncPolicies('manual')

    expect(lifecycleClientFactory.create).toHaveBeenCalledTimes(1)
    expect(putBucketLifecycle).toHaveBeenCalledTimes(1)
    expect(putBucketLifecycle).toHaveBeenCalledWith(
      'mediaclaw-archive',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mediaclaw-backup-daily-retention',
          prefix: 'backups/mongodb/daily/',
        }),
        expect.objectContaining({
          id: 'mediaclaw-video-transition-ia',
          prefix: 'videos/',
        }),
      ]),
    )
    expect(result.enabled).toBe(true)
    expect(result.compliant).toBe(true)
    expect(result.targets).toHaveLength(2)
    expect(result.targets.every(target => target.compliant)).toBe(true)
  })

  it('应在缺少 OSS 凭证时标记为未合规', async () => {
    configService.getString = vi.fn((key: string | string[], fallback = '') => {
      const normalizedKeys = Array.isArray(key) ? key : [key]
      if (normalizedKeys.includes('BACKUP_BUCKET_URL')) {
        return 'oss://mediaclaw-archive/backups/mongodb'
      }
      return fallback
    })

    service = new StorageLifecycleService(
      configService as any,
      lifecycleClientFactory,
    )

    const result = await service.syncPolicies('manual')

    expect(lifecycleClientFactory.create).not.toHaveBeenCalled()
    expect(result.enabled).toBe(true)
    expect(result.compliant).toBe(false)
    expect(result.targets).toHaveLength(1)
    expect(result.targets[0].configured).toBe(false)
    expect(result.targets[0].message).toContain('missing OSS credentials')
  })
})
