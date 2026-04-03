import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Organization, OrganizationEnterpriseProfile } from '@yikart/mongodb'
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
    const updates: Record<string, unknown> = {}
    const nextSettings = data.settings && typeof data.settings === 'object'
      ? { ...data.settings }
      : null

    this.assignTrimmedString(updates, 'name', data.name)
    this.assignTrimmedString(updates, 'contactName', data.contactName)
    this.assignTrimmedString(updates, 'contactPhone', data.contactPhone)
    this.assignTrimmedString(updates, 'contactEmail', data.contactEmail)

    const enterpriseProfile = this.extractEnterpriseProfile(data)
    if (enterpriseProfile) {
      this.assignTrimmedString(
        updates,
        'enterpriseProfile.companyName',
        enterpriseProfile.companyName,
      )
      this.assignTrimmedString(
        updates,
        'enterpriseProfile.businessLicenseUrl',
        enterpriseProfile.businessLicenseUrl,
      )
      this.assignTrimmedString(
        updates,
        'enterpriseProfile.unifiedSocialCreditCode',
        enterpriseProfile.unifiedSocialCreditCode,
      )
      this.assignTrimmedString(
        updates,
        'enterpriseProfile.legalRepresentative',
        enterpriseProfile.legalRepresentative,
      )
      this.assignTrimmedString(
        updates,
        'enterpriseProfile.registeredAddress',
        enterpriseProfile.registeredAddress,
      )
      this.assignTrimmedString(
        updates,
        'enterpriseProfile.industry',
        enterpriseProfile.industry,
      )
      this.assignTrimmedString(
        updates,
        'enterpriseProfile.officialWebsite',
        enterpriseProfile.officialWebsite,
      )
      this.assignTrimmedString(
        updates,
        'enterpriseProfile.description',
        enterpriseProfile.description,
      )

      if (typeof enterpriseProfile.industry === 'string' && enterpriseProfile.industry.trim()) {
        updates['settings'] = {
          ...(nextSettings || {}),
          industry: enterpriseProfile.industry.trim(),
        }
      }
    }

    if (!updates['settings'] && nextSettings) {
      updates['settings'] = nextSettings
    }

    return updates
  }

  private extractEnterpriseProfile(data: Partial<Organization>) {
    const rawProfile = data.enterpriseProfile
    if (!rawProfile || typeof rawProfile !== 'object') {
      return null
    }

    return rawProfile as Partial<OrganizationEnterpriseProfile>
  }

  private assignTrimmedString(
    updates: Record<string, unknown>,
    key: string,
    value: string | null | undefined,
  ) {
    if (typeof value !== 'string') {
      return
    }

    updates[key] = value.trim()
  }

  private toObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('orgId is invalid')
    }

    return new Types.ObjectId(id)
  }
}
