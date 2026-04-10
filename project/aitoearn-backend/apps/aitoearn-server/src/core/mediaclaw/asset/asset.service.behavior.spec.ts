import { BrandAssetType, NotificationEvent } from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationService } from '../notification/notification.service'
import { AssetService } from './asset.service'

function createExecQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('assetService behavior', () => {
  const orgId = new Types.ObjectId().toString()
  const brandId = new Types.ObjectId()

  let brandModel: Record<string, any>
  let brandAssetVersionModel: Record<string, any>
  let notificationService: Record<string, any>
  let service: AssetService

  beforeEach(() => {
    brandModel = {
      exists: vi.fn().mockResolvedValue(true),
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn().mockReturnValue(createExecQuery({})),
    }
    brandAssetVersionModel = {
      findOne: vi.fn(),
      updateMany: vi.fn().mockReturnValue(createExecQuery({ modifiedCount: 1 })),
      create: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn().mockReturnValue(createExecQuery({})),
    }
    notificationService = {
      send: vi.fn().mockResolvedValue(undefined),
    } satisfies Partial<NotificationService>

    service = new AssetService(
      brandModel as any,
      brandAssetVersionModel as any,
      notificationService as any,
    )
  })

  it('在上传新素材版本后发送变更通知', async () => {
    const createdId = new Types.ObjectId()
    brandAssetVersionModel.findOne.mockReturnValueOnce(createExecQuery({ version: 2 }))
    brandAssetVersionModel.create.mockResolvedValue({
      _id: createdId,
      brandId,
      assetType: BrandAssetType.LOGO,
      version: 3,
      fileUrl: 'https://cdn.example.com/logo-v3.png',
      fileName: 'logo-v3.png',
      uploadedBy: 'tester',
    })
    brandModel.findOne.mockReturnValue(
      createExecQuery({
        _id: brandId,
        orgId: new Types.ObjectId(orgId),
        name: '测试品牌',
        isActive: true,
      }),
    )

    await service.uploadAsset(orgId, brandId.toString(), BrandAssetType.LOGO, {
      fileUrl: 'https://cdn.example.com/logo-v3.png',
      fileName: 'logo-v3.png',
      uploadedBy: 'tester',
    })

    expect(notificationService.send).toHaveBeenCalledWith(
      orgId,
      NotificationEvent.ASSET_VERSION_UPLOADED,
      expect.objectContaining({
        assetId: createdId.toString(),
        brandId: brandId.toString(),
        brandName: '测试品牌',
        assetType: BrandAssetType.LOGO,
        version: 3,
      }),
    )
  })

  it('在切换生效版本后发送激活通知', async () => {
    const assetId = new Types.ObjectId()
    const previousId = new Types.ObjectId()
    const asset = {
      _id: assetId,
      brandId,
      assetType: BrandAssetType.LOGO,
      version: 4,
      fileUrl: 'https://cdn.example.com/logo-v4.png',
      fileName: 'logo-v4.png',
      isActive: false,
      deletedAt: null,
    }
    brandAssetVersionModel.findById.mockReturnValue(createExecQuery(asset))
    brandAssetVersionModel.findOne
      .mockReturnValueOnce(
        createExecQuery({
          _id: previousId,
          brandId,
          assetType: BrandAssetType.LOGO,
          version: 2,
          isActive: true,
          deletedAt: null,
        }),
      )
    brandAssetVersionModel.findByIdAndUpdate.mockReturnValue(
      createExecQuery({
        ...asset,
        isActive: true,
      }),
    )
    brandModel.findOne.mockReturnValue(
      createExecQuery({
        _id: brandId,
        orgId: new Types.ObjectId(orgId),
        name: '测试品牌',
        isActive: true,
      }),
    )

    await service.setActive(orgId, assetId.toString())

    expect(notificationService.send).toHaveBeenCalledWith(
      orgId,
      NotificationEvent.ASSET_VERSION_ACTIVATED,
      expect.objectContaining({
        assetId: assetId.toString(),
        version: 4,
        previousVersion: 2,
      }),
    )
  })

  it('在删除当前生效版本后发送回退通知', async () => {
    const assetId = new Types.ObjectId()
    const fallbackId = new Types.ObjectId()
    const asset = {
      _id: assetId,
      brandId,
      assetType: BrandAssetType.LOGO,
      version: 5,
      fileUrl: 'https://cdn.example.com/logo-v5.png',
      fileName: 'logo-v5.png',
      isActive: true,
      deletedAt: null,
    }
    brandAssetVersionModel.findById.mockReturnValue(createExecQuery(asset))
    brandAssetVersionModel.findOne
      .mockReturnValueOnce(
        createExecQuery({
          _id: fallbackId,
          brandId,
          assetType: BrandAssetType.LOGO,
          version: 4,
          fileUrl: 'https://cdn.example.com/logo-v4.png',
          isActive: false,
          deletedAt: null,
        }),
      )
      .mockReturnValueOnce(
        createExecQuery({
          _id: fallbackId,
          brandId,
          assetType: BrandAssetType.LOGO,
          version: 4,
          fileUrl: 'https://cdn.example.com/logo-v4.png',
          isActive: true,
          deletedAt: null,
        }),
      )
    brandModel.findOne.mockReturnValue(
      createExecQuery({
        _id: brandId,
        orgId: new Types.ObjectId(orgId),
        name: '测试品牌',
        isActive: true,
      }),
    )

    await service.deleteVersion(orgId, assetId.toString())

    expect(notificationService.send).toHaveBeenCalledWith(
      orgId,
      NotificationEvent.ASSET_VERSION_DELETED,
      expect.objectContaining({
        assetId: assetId.toString(),
        version: 5,
        fallbackVersion: 4,
      }),
    )
  })
})
