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

  async findById(id: string) {
    const brand = await this.brandModel.findById(id).exec()
    if (!brand)
      throw new NotFoundException('Brand not found')
    return brand
  }

  async update(id: string, data: Partial<Brand>) {
    return this.brandModel.findByIdAndUpdate(id, data, { new: true }).exec()
  }

  async delete(id: string) {
    return this.brandModel.findByIdAndUpdate(id, { isActive: false }, { new: true }).exec()
  }

  /**
   * Upload brand assets (logo, reference images)
   */
  async updateAssets(id: string, assets: {
    logoUrl?: string
    referenceImages?: string[]
  }) {
    const update: any = {}
    if (assets.logoUrl)
      update.logoUrl = assets.logoUrl
    if (assets.referenceImages)
      update['visualIdentity.referenceImages'] = assets.referenceImages
    return this.brandModel.findByIdAndUpdate(id, { $set: update }, { new: true }).exec()
  }

  /**
   * Update video style preferences
   */
  async updateVideoStyle(id: string, style: {
    preferredDuration?: number
    aspectRatio?: string
    subtitleStyle?: Record<string, any>
  }) {
    return this.brandModel.findByIdAndUpdate(
      id,
      { $set: { videoStyle: style } },
      { new: true },
    ).exec()
  }
}
