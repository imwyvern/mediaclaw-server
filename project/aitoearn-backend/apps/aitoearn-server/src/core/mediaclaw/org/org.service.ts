import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Organization,
  OrganizationEnterpriseProfile,
  OrganizationModelPreferenceKey,
  UserRole,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { EnterpriseAuthService } from '../auth/enterprise-auth.service'
import { ModelResolverService } from '../model-resolver/model-resolver.service'
import { OrgMemberAdminService } from './org-member-admin.service'

@Injectable()
export class OrgService {
  constructor(
    @InjectModel(Organization.name) private readonly orgModel: Model<Organization>,
    private readonly modelResolverService: ModelResolverService,
    private readonly orgMemberAdminService: OrgMemberAdminService,
    private readonly enterpriseAuthService: EnterpriseAuthService,
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

  async listMembers(orgId: string) {
    return this.orgMemberAdminService.listMembers(orgId)
  }

  async listPendingInvites(orgId: string) {
    return this.enterpriseAuthService.listPendingInvites(orgId)
  }

  async inviteMember(
    orgId: string,
    phone: string,
    role: UserRole = UserRole.EMPLOYEE,
    invitedByUserId?: string,
  ) {
    return this.enterpriseAuthService.inviteByPhone(orgId, phone, role, invitedByUserId)
  }

  async updateMemberRole(orgId: string, userId: string, role: UserRole) {
    return this.orgMemberAdminService.updateMemberRole(orgId, userId, role)
  }

  async removeMember(orgId: string, userId: string) {
    return this.orgMemberAdminService.removeMember(orgId, userId)
  }

  async revokeInvite(orgId: string, inviteId: string) {
    return this.enterpriseAuthService.revokeInvite(orgId, inviteId)
  }

  async getModelPreferences(orgId: string) {
    return this.modelResolverService.getOrganizationModelSettings(orgId)
  }

  async updateModelPreferences(
    orgId: string,
    preferences: Partial<Record<OrganizationModelPreferenceKey, string | null | undefined>>,
  ) {
    const normalized = await this.modelResolverService.validateOrganizationPreferences(orgId, preferences)
    const updated = await this.orgModel.findByIdAndUpdate(
      this.toObjectId(orgId),
      {
        $set: {
          modelPreferences: normalized,
        },
      },
      { new: true },
    ).exec()

    if (!updated) {
      throw new NotFoundException('Organization not found')
    }

    return this.modelResolverService.getOrganizationModelSettings(orgId)
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
