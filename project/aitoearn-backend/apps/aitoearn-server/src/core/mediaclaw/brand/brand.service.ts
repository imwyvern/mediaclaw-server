import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

@Injectable()
export class BrandService {
  constructor(
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
  ) {}

  async create(orgId: string, data: Partial<Brand>) {
    return this.brandModel.create({
      ...data,
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

  async update(orgId: string, id: string, data: Partial<Brand>) {
    await this.findOwnedBrand(orgId, id)
    return this.brandModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      data,
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
      update['logoUrl'] = assets.logoUrl
    if (assets.referenceImages)
      update['visualIdentity.referenceImages'] = assets.referenceImages
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
}
