import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import {
  LayerBillingPolicy,
  LayerPermissionPolicy,
  LayerQuotaPolicy,
  Organization,
  OrganizationEnterpriseProfile,
  OrganizationModelPreferenceKey,
  OrganizationPlatformLayer,
  UserRole,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { EnterpriseAuthService } from '../auth/enterprise-auth.service'
import { ModelResolverService } from '../model-resolver/model-resolver.service'
import {
  normalizeLayerBillingPolicy,
  normalizeLayerPermissionPolicy,
  normalizeLayerQuotaPolicy,
} from '../shared/layer-policy.utils'
import { OrgMemberAdminService } from './org-member-admin.service'

interface PlatformLayerPatch {
  quotaPolicy?: Partial<LayerQuotaPolicy>
  billingPolicy?: Partial<LayerBillingPolicy>
  permissionPolicy?: Partial<LayerPermissionPolicy>
  strategy?: {
    enableCrossInstanceStats?: boolean
    enableOpsConsole?: boolean
    allowSkillMarketplace?: boolean
    rolloutChannel?: string
  }
}

export type OrganizationUpdateInput = Omit<Partial<Organization>, 'enterpriseProfile'> & {
  enterpriseProfile?: Partial<OrganizationEnterpriseProfile>
}

@Injectable()
export class OrgService {
  constructor(
    @Inject(getModelToken(Organization.name)) private readonly orgModel: Model<Organization>,
    private readonly modelResolverService: ModelResolverService,
    private readonly orgMemberAdminService: OrgMemberAdminService,
    private readonly enterpriseAuthService: EnterpriseAuthService,
  ) {}

  async createForCurrentOrg(orgId: string, data: OrganizationUpdateInput) {
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

  async update(id: string, data: OrganizationUpdateInput) {
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

  async getPlatformLayer(orgId: string) {
    const org = await this.findById(orgId)
    return this.buildPlatformLayerResponse(org)
  }

  async updatePlatformLayer(
    orgId: string,
    layer: PlatformLayerPatch,
  ) {
    const current = await this.findById(orgId)
    const nextLayer = this.buildPlatformLayer(current.platformLayer, layer)
    const updated = await this.orgModel.findByIdAndUpdate(
      this.toObjectId(orgId),
      {
        $set: {
          platformLayer: nextLayer,
        },
      },
      { new: true },
    ).exec()

    if (!updated) {
      throw new NotFoundException('Organization not found')
    }

    return this.buildPlatformLayerResponse(updated)
  }

  private pickEditableFields(data: OrganizationUpdateInput) {
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

  private buildPlatformLayer(
    current?: Partial<OrganizationPlatformLayer> | null,
    overrides?: PlatformLayerPatch | null,
  ): OrganizationPlatformLayer {
    return {
      quotaPolicy: normalizeLayerQuotaPolicy({
        ...(current?.quotaPolicy || {}),
        ...(overrides?.quotaPolicy || {}),
      }),
      billingPolicy: normalizeLayerBillingPolicy({
        ...(current?.billingPolicy || {}),
        ...(overrides?.billingPolicy || {}),
      }),
      permissionPolicy: normalizeLayerPermissionPolicy({
        ...(current?.permissionPolicy || {}),
        ...(overrides?.permissionPolicy || {}),
      }),
      strategy: this.buildPlatformStrategy(current?.strategy, overrides?.strategy),
    }
  }

  private buildPlatformStrategy(
    current?: {
      enableCrossInstanceStats?: boolean
      enableOpsConsole?: boolean
      allowSkillMarketplace?: boolean
      rolloutChannel?: string
    } | null,
    overrides?: {
      enableCrossInstanceStats?: boolean
      enableOpsConsole?: boolean
      allowSkillMarketplace?: boolean
      rolloutChannel?: string
    } | null,
  ) {
    return {
      enableCrossInstanceStats:
        overrides?.enableCrossInstanceStats ?? current?.enableCrossInstanceStats ?? true,
      enableOpsConsole:
        overrides?.enableOpsConsole ?? current?.enableOpsConsole ?? true,
      allowSkillMarketplace:
        overrides?.allowSkillMarketplace ?? current?.allowSkillMarketplace ?? true,
      rolloutChannel: typeof overrides?.rolloutChannel === 'string'
        ? overrides.rolloutChannel.trim() || 'stable'
        : typeof current?.rolloutChannel === 'string'
          ? current.rolloutChannel.trim() || 'stable'
          : 'stable',
    }
  }

  private buildPlatformLayerResponse(org: Organization) {
    return {
      orgId: org._id.toString(),
      orgName: org.name,
      status: org.status,
      platformLayer: this.buildPlatformLayer(org.platformLayer),
      summary: {
        billingMode: org.billingMode,
        monthlyQuota: org.monthlyQuota,
        monthlyUsed: org.monthlyUsed,
      },
    }
  }

  private extractEnterpriseProfile(data: OrganizationUpdateInput) {
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
