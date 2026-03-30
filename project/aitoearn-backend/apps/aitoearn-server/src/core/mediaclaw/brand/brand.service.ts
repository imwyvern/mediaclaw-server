import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Brand } from '@yikart/mongodb'

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
    return this.brandModel.find({ orgId: new Types.ObjectId(orgId) }).exec()
  }

  async findById(id: string) {
    const brand = await this.brandModel.findById(id).exec()
    if (!brand) throw new NotFoundException('Brand not found')
    return brand
  }

  async update(id: string, data: Partial<Brand>) {
    return this.brandModel.findByIdAndUpdate(id, data, { new: true }).exec()
  }

  async delete(id: string) {
    return this.brandModel.findByIdAndUpdate(id, { isActive: false }, { new: true }).exec()
  }
}
