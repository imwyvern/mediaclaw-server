import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Brand,
  BrandAssetType,
  BrandAssetVersion,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

interface AssetUploadInput {
  fileUrl?: string
  fileName?: string
  fileSize?: number
  mimeType?: string
  metadata?: Record<string, any>
  uploadedBy?: string
}

@Injectable()
export class AssetService {
  constructor(
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(BrandAssetVersion.name)
    private readonly brandAssetVersionModel: Model<BrandAssetVersion>,
  ) {}

  async uploadAsset(orgId: string, brandId: string, type: BrandAssetType, file: AssetUploadInput) {
    const normalizedBrandId = this.toObjectId(brandId, 'brandId')
    this.ensureAssetType(type)
    await this.ensureBrandExists(orgId, normalizedBrandId)

    const version = await this.getNextVersion(normalizedBrandId, type)
    const fileName = file.fileName?.trim() || `v${version}-${type}`
    const fileUrl = file.fileUrl?.trim() || this.buildFallbackFileUrl(brandId, type, version, fileName)

    if (!fileUrl) {
      throw new BadRequestException('fileUrl or file is required')
    }

    await this.brandAssetVersionModel.updateMany(
      {
        brandId: normalizedBrandId,
        assetType: type,
        deletedAt: null,
      },
      { isActive: false },
    ).exec()

    return this.brandAssetVersionModel.create({
      brandId: normalizedBrandId,
      assetType: type,
      version,
      fileUrl,
      fileName,
      fileSize: Number(file.fileSize) || 0,
      mimeType: file.mimeType || '',
      uploadedBy: file.uploadedBy || '',
      isActive: true,
      metadata: file.metadata || {},
      deletedAt: null,
    })
  }

  async listVersions(orgId: string, brandId: string, type: BrandAssetType) {
    this.ensureAssetType(type)
    await this.ensureBrandExists(orgId, this.toObjectId(brandId, 'brandId'))

    const items = await this.brandAssetVersionModel
      .find({
        brandId: this.toObjectId(brandId, 'brandId'),
        assetType: type,
        deletedAt: null,
      })
      .sort({ version: -1, createdAt: -1 })
      .lean()
      .exec()

    return items.map(item => ({
      id: item._id.toString(),
      brandId: item.brandId.toString(),
      assetType: item.assetType,
      version: item.version,
      fileUrl: item.fileUrl,
      fileName: item.fileName,
      fileSize: item.fileSize,
      mimeType: item.mimeType,
      uploadedBy: item.uploadedBy,
      isActive: item.isActive,
      metadata: item.metadata,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
  }

  async setActive(orgId: string, assetId: string) {
    const asset = await this.findOwnedAsset(orgId, assetId)
    if (!asset || asset.deletedAt) {
      throw new NotFoundException('Asset version not found')
    }

    await this.brandAssetVersionModel.updateMany(
      {
        brandId: asset.brandId,
        assetType: asset.assetType,
        deletedAt: null,
      },
      { isActive: false },
    ).exec()

    return this.brandAssetVersionModel.findByIdAndUpdate(
      asset._id,
      { isActive: true },
      { new: true },
    ).exec()
  }

  async getActiveAsset(orgId: string, brandId: string, type: BrandAssetType) {
    this.ensureAssetType(type)
    await this.ensureBrandExists(orgId, this.toObjectId(brandId, 'brandId'))

    const asset = await this.brandAssetVersionModel
      .findOne({
        brandId: this.toObjectId(brandId, 'brandId'),
        assetType: type,
        isActive: true,
        deletedAt: null,
      })
      .sort({ version: -1 })
      .lean()
      .exec()

    if (!asset) {
      throw new NotFoundException('Active asset not found')
    }

    return {
      id: asset._id.toString(),
      brandId: asset.brandId.toString(),
      assetType: asset.assetType,
      version: asset.version,
      fileUrl: asset.fileUrl,
      fileName: asset.fileName,
      fileSize: asset.fileSize,
      mimeType: asset.mimeType,
      uploadedBy: asset.uploadedBy,
      metadata: asset.metadata,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    }
  }

  async deleteVersion(orgId: string, assetId: string) {
    const asset = await this.findOwnedAsset(orgId, assetId)
    if (!asset || asset.deletedAt) {
      throw new NotFoundException('Asset version not found')
    }

    const deletedAt = new Date()
    await this.brandAssetVersionModel.findByIdAndUpdate(asset._id, {
      deletedAt,
      isActive: false,
    }).exec()

    if (asset.isActive) {
      const fallback = await this.brandAssetVersionModel
        .findOne({
          brandId: asset.brandId,
          assetType: asset.assetType,
          deletedAt: null,
          _id: { $ne: asset._id },
        })
        .sort({ version: -1, createdAt: -1 })
        .exec()

      if (fallback) {
        await this.brandAssetVersionModel.findByIdAndUpdate(fallback._id, {
          isActive: true,
        }).exec()
      }
    }

    return {
      id: asset._id.toString(),
      deleted: true,
    }
  }

  private async getNextVersion(brandId: Types.ObjectId, type: BrandAssetType) {
    const latest = await this.brandAssetVersionModel
      .findOne({
        brandId,
        assetType: type,
      })
      .sort({ version: -1 })
      .lean()
      .exec()

    return (latest?.version || 0) + 1
  }

  private buildFallbackFileUrl(brandId: string, type: BrandAssetType, version: number, fileName: string) {
    const safeName = fileName.replace(/\s+/g, '-').replace(/[^\w.-]/g, '').toLowerCase() || 'asset'
    return `brand-assets/${brandId}/${type}/v${version}/${Date.now()}-${safeName}`
  }

  private async ensureBrandExists(orgId: string, brandId: unknown) {
    const normalizedBrandId = typeof brandId === 'string'
      ? this.toObjectId(brandId, 'brandId')
      : this.toObjectId(String(brandId), 'brandId')

    const exists = await this.brandModel.exists({
      _id: normalizedBrandId,
      orgId: this.toObjectId(orgId, 'orgId'),
      isActive: true,
    })
    if (!exists) {
      throw new NotFoundException('Brand not found')
    }
  }

  private async findOwnedAsset(orgId: string, assetId: string) {
    const asset = await this.brandAssetVersionModel.findById(this.toObjectId(assetId, 'assetId')).exec()
    if (!asset) {
      throw new NotFoundException('Asset version not found')
    }

    await this.ensureBrandExists(orgId, asset.brandId)
    return asset
  }

  private ensureAssetType(type: BrandAssetType) {
    if (!Object.values(BrandAssetType).includes(type)) {
      throw new BadRequestException('Invalid asset type')
    }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }
}
