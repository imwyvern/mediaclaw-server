import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

type BrandInput = Partial<Brand> & {
  category?: string
  logoUrl?: string
}

@Injectable()
export class BrandService {
  constructor(
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
  ) {}

  async create(orgId: string, data: BrandInput) {
    const normalized = this.normalizeCreatePayload(data)
    return this.brandModel.create({
      ...normalized,
      orgId: new Types.ObjectId(orgId),
    })
  }

  async findByOrg(orgId: string) {
    return this.brandModel.find({
      orgId: new Types.ObjectId(orgId),
      isActive: true,
    }).exec()
  }

  async findById(orgId: string, id: string) {
    return this.findOwnedBrand(orgId, id)
  }

  async update(orgId: string, id: string, data: BrandInput) {
    await this.findOwnedBrand(orgId, id)
    const normalized = this.normalizeUpdatePayload(data)
    return this.brandModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      normalized,
      { new: true },
    ).exec()
  }

  async delete(orgId: string, id: string) {
    await this.findOwnedBrand(orgId, id)
    return this.brandModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      { isActive: false },
      { new: true },
    ).exec()
  }

  /**
   * Upload brand assets (logo, reference images)
   */
  async updateAssets(orgId: string, id: string, assets: {
    logoUrl?: string
    referenceImages?: string[]
  }) {
    await this.findOwnedBrand(orgId, id)
    const update: Record<string, unknown> = {}
    if (assets.logoUrl)
      update['assets.logoUrl'] = assets.logoUrl
    if (assets.referenceImages)
      update['assets.referenceImages'] = assets.referenceImages
    return this.brandModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      { $set: update },
      { new: true },
    ).exec()
  }

  /**
   * Update video style preferences
   */
  async updateVideoStyle(orgId: string, id: string, style: {
    preferredDuration?: number
    aspectRatio?: string
    subtitleStyle?: Record<string, unknown>
  }) {
    await this.findOwnedBrand(orgId, id)
    return this.brandModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      { $set: { videoStyle: style } },
      { new: true },
    ).exec()
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
      isActive: true,
    }
  }

  private async findOwnedBrand(orgId: string, id: string) {
    const brand = await this.brandModel.findOne(this.buildOwnedQuery(orgId, id)).exec()
    if (!brand) {
      throw new NotFoundException('Brand not found')
    }

    return brand
  }

  private normalizeCreatePayload(data: BrandInput) {
    return {
      name: data.name,
      industry: this.resolveIndustry(data),
      assets: {
        ...(data.assets || {}),
        ...(data.logoUrl ? { logoUrl: String(data.logoUrl) } : {}),
      },
      ...(data.videoStyle ? { videoStyle: data.videoStyle } : {}),
      ...(typeof data.isActive === 'boolean' ? { isActive: data.isActive } : {}),
    }
  }

  private normalizeUpdatePayload(data: BrandInput) {
    const setPayload: Record<string, unknown> = {}

    if (typeof data.name === 'string') {
      setPayload['name'] = data.name
    }

    const industry = this.resolveIndustry(data)
    if (industry) {
      setPayload['industry'] = industry
    }

    if (data.assets) {
      setPayload['assets'] = data.assets
    }

    if (data.logoUrl) {
      setPayload['assets.logoUrl'] = String(data.logoUrl)
    }

    if (data.videoStyle) {
      setPayload['videoStyle'] = data.videoStyle
    }

    if (typeof data.isActive === 'boolean') {
      setPayload['isActive'] = data.isActive
    }

    return { $set: setPayload }
  }

  private resolveIndustry(data: BrandInput) {
    const industry = typeof data.industry === 'string' ? data.industry.trim() : ''
    const category = typeof data.category === 'string' ? data.category.trim() : ''
    return industry || category || ''
  }
}
