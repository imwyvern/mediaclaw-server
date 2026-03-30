import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Organization } from '@yikart/mongodb'
import { Model } from 'mongoose'

@Injectable()
export class OrgService {
  constructor(
    @InjectModel(Organization.name) private readonly orgModel: Model<Organization>,
  ) {}

  async create(data: Partial<Organization>) {
    return this.orgModel.create(data)
  }

  async findById(id: string) {
    const org = await this.orgModel.findById(id).exec()
    if (!org)
      throw new NotFoundException('Organization not found')
    return org
  }

  async update(id: string, data: Partial<Organization>) {
    return this.orgModel.findByIdAndUpdate(id, data, { new: true }).exec()
  }

  async findAll() {
    return this.orgModel.find({ status: { $ne: 'suspended' } }).exec()
  }
}
