import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Organization } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

@Injectable()
export class OrgService {
  constructor(
    @InjectModel(Organization.name) private readonly orgModel: Model<Organization>,
  ) {}

  async createForCurrentOrg(orgId: string, data: Partial<Organization>) {
    const existing = await this.findById(orgId)
    if (existing) {
      return this.update(orgId, data)
    }

    throw new BadRequestException('Use enterprise registration to create a new organization')
  }

  async findById(id: string) {
    const org = await this.orgModel.findById(this.toObjectId(id)).exec()
    if (!org)
      throw new NotFoundException('Organization not found')
    return org
  }

  async update(id: string, data: Partial<Organization>) {
    const updates = this.pickEditableFields(data)
    const updated = await this.orgModel.findByIdAndUpdate(
      this.toObjectId(id),
      updates,
      { new: true },
    ).exec()

    if (!updated) {
      throw new NotFoundException('Organization not found')
    }

    return updated
  }

  async findAll() {
    return this.orgModel.find({ status: { $ne: 'suspended' } }).exec()
  }

  private pickEditableFields(data: Partial<Organization>) {
    return {
      ...(typeof data.name === 'string' ? { name: data.name } : {}),
      ...(typeof data.contactName === 'string' ? { contactName: data.contactName } : {}),
      ...(typeof data.contactPhone === 'string' ? { contactPhone: data.contactPhone } : {}),
      ...(typeof data.contactEmail === 'string' ? { contactEmail: data.contactEmail } : {}),
      ...(data.settings && typeof data.settings === 'object' ? { settings: data.settings } : {}),
    }
  }

  private toObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('orgId is invalid')
    }

    return new Types.ObjectId(id)
  }
}
