import { createHash, randomBytes } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  BillingMode,
  EnterpriseInvite,
  EnterpriseInviteStatus,
  isEnterpriseAssignableRole,
  McUserType,
  MediaClawUser,
  normalizeUserRole,
  Organization,
  OrganizationEnterpriseProfile,
  OrgStatus,
  OrgType,
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
  UserRole,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { McAuthService } from './auth.service'

interface RegisterEnterpriseInput {
  orgName: string
  adminPhone: string
  adminName?: string
  contactEmail?: string
  contactName?: string
  monthlyQuota?: number
  companyName?: string
  businessLicenseUrl?: string
  unifiedSocialCreditCode?: string
  legalRepresentative?: string
  registeredAddress?: string
  industry?: string
  officialWebsite?: string
  description?: string
}

type OrgMembershipRecord = {
  orgId: { toString: () => string }
  role: UserRole
  joinedAt: Date
}

type OrganizationResponseInput = {
  _id: { toString: () => string }
  name: string
  type: OrgType
  status: OrgStatus
  billingMode: BillingMode
  contactName: string
  contactPhone: string
  contactEmail: string
  monthlyQuota: number
  monthlyUsed: number
  subscriptionExpiresAt: Date | null
  enterpriseProfile?: Partial<OrganizationEnterpriseProfile>
}

@Injectable()
export class EnterpriseAuthService {
  constructor(
    @InjectModel(MediaClawUser.name)
    private readonly userModel: Model<MediaClawUser>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(EnterpriseInvite.name)
    private readonly enterpriseInviteModel: Model<EnterpriseInvite>,
    private readonly authService: McAuthService,
  ) {}

  async registerEnterprise(data: RegisterEnterpriseInput) {
    const orgName = data.orgName?.trim()
    if (!orgName) {
      throw new BadRequestException('orgName is required')
    }

    this.authService.validatePhoneNumber(data.adminPhone)

    const now = new Date()
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    const industry = this.normalizeOptionalString(data.industry)
    const organization = await this.organizationModel.create({
      name: orgName,
      type: OrgType.ENTERPRISE,
      billingMode: BillingMode.QUOTA,
      status: OrgStatus.TRIAL,
      contactName: data.contactName?.trim() || data.adminName?.trim() || '',
      contactPhone: data.adminPhone,
      contactEmail: data.contactEmail?.trim() || '',
      monthlyQuota: Math.max(1, Math.trunc(Number(data.monthlyQuota) || 50)),
      monthlyUsed: 0,
      subscriptionExpiresAt: trialEnd,
      enterpriseProfile: {
        companyName: this.normalizeOptionalString(data.companyName) || orgName,
        businessLicenseUrl: this.normalizeOptionalString(data.businessLicenseUrl) || '',
        unifiedSocialCreditCode: this.normalizeOptionalString(data.unifiedSocialCreditCode) || '',
        legalRepresentative: this.normalizeOptionalString(data.legalRepresentative) || '',
        registeredAddress: this.normalizeOptionalString(data.registeredAddress) || '',
        industry: industry || '',
        officialWebsite: this.normalizeOptionalString(data.officialWebsite) || '',
        description: this.normalizeOptionalString(data.description) || '',
      },
      settings: industry ? { industry } : {},
    })

    const subscription = await this.subscriptionModel.create({
      orgId: organization._id,
      plan: SubscriptionPlan.TEAM,
      status: SubscriptionStatus.ACTIVE,
      billingMode: BillingMode.QUOTA,
      monthlyFeeCents: 0,
      perVideoCents: 0,
      monthlyQuota: organization.monthlyQuota,
      monthlyUsed: 0,
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
      autoRenew: false,
      encryptedApiKey: '',
    })

    const adminRole = UserRole.ENTERPRISE_ADMIN
    const { user, isNewUser } = await this.findOrCreateUserByPhone(data.adminPhone, {
      fallbackName: data.adminName?.trim() || `${orgName}管理员`,
      defaultRole: adminRole,
    })

    const updatedUser = await this.assignUserToOrg(
      user,
      organization._id.toString(),
      adminRole,
      true,
    )

    return {
      organization: this.toOrgResponse(organization.toObject()),
      subscription: this.toSubscriptionResponse(subscription.toObject()),
      ...this.authService.buildAuthResult(updatedUser, isNewUser),
    }
  }

  async inviteByPhone(
    orgId: string,
    phone: string,
    role: UserRole,
    invitedByUserId?: string,
  ) {
    const organization = await this.organizationModel.findById(this.toObjectId(orgId, 'orgId')).exec()
    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    this.authService.validatePhoneNumber(phone)
    const normalizedRole = this.ensureValidRole(role)

    await this.authService.sendSmsCode(phone)

    await this.enterpriseInviteModel.updateMany(
      {
        orgId: organization._id,
        phone,
        status: EnterpriseInviteStatus.PENDING,
      },
      {
        $set: {
          status: EnterpriseInviteStatus.REVOKED,
        },
      },
    ).exec()

    const token = randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const invite = await this.enterpriseInviteModel.create({
      orgId: organization._id,
      phone,
      role: normalizedRole,
      tokenHash: this.hashInviteToken(token),
      invitedByUserId: this.toOptionalObjectId(invitedByUserId),
      invitedAt: new Date(),
      expiresAt,
      status: EnterpriseInviteStatus.PENDING,
    })

    return {
      id: invite._id.toString(),
      token,
      orgId: organization._id.toString(),
      orgName: organization.name,
      phone,
      role: normalizedRole,
      status: EnterpriseInviteStatus.PENDING,
      invitedAt: invite.invitedAt,
      expiresAt: expiresAt.toISOString(),
      inviteSent: true,
    }
  }

  async acceptInvite(token: string, phone: string, code: string) {
    const normalizedPhone = phone?.trim()
    if (!normalizedPhone) {
      throw new BadRequestException('phone is required')
    }

    const inviteRecord = await this.enterpriseInviteModel.findOne({
      tokenHash: this.hashInviteToken(token),
      phone: normalizedPhone,
      status: EnterpriseInviteStatus.PENDING,
    }).exec()

    if (!inviteRecord) {
      throw new BadRequestException('Invite token is invalid or expired')
    }

    if (inviteRecord.expiresAt.getTime() < Date.now()) {
      await this.enterpriseInviteModel.findByIdAndUpdate(inviteRecord._id, {
        status: EnterpriseInviteStatus.EXPIRED,
      }).exec()
      throw new BadRequestException('Invite token is invalid or expired')
    }

    const organization = await this.organizationModel.findById(inviteRecord.orgId).exec()
    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    await this.authService.consumeSmsCode(normalizedPhone, code)

    const { user, isNewUser } = await this.findOrCreateUserByPhone(normalizedPhone, {
      fallbackName: `${organization.name}成员`,
      defaultRole: inviteRecord.role,
    })

    const updatedUser = await this.assignUserToOrg(
      user,
      organization._id.toString(),
      inviteRecord.role,
      true,
    )

    await this.enterpriseInviteModel.findByIdAndUpdate(inviteRecord._id, {
      status: EnterpriseInviteStatus.ACCEPTED,
      acceptedAt: new Date(),
    }).exec()

    return {
      organization: this.toOrgResponse(organization.toObject()),
      ...this.authService.buildAuthResult(updatedUser, isNewUser),
    }
  }

  async switchOrg(userId: string, orgId: string) {
    const user = await this.userModel.findById(this.toObjectId(userId, 'userId')).exec()
    if (!user) {
      throw new NotFoundException('User not found')
    }

    const membership = this.findMembership(user, orgId)
    if (!membership) {
      throw new BadRequestException('User does not belong to the organization')
    }

    const updatedUser = await this.userModel.findByIdAndUpdate(
      user._id,
      {
        $set: {
          orgId: membership.orgId,
          role: normalizeUserRole(membership.role),
          userType: McUserType.ENTERPRISE,
        },
      },
      { new: true },
    ).exec()

    if (!updatedUser) {
      throw new NotFoundException('User not found')
    }

    return this.authService.buildAuthResult(updatedUser, false)
  }

  async listUserOrgs(userId: string) {
    const user = await this.userModel.findById(this.toObjectId(userId, 'userId')).lean().exec()
    if (!user) {
      throw new NotFoundException('User not found')
    }

    const orgIds = (user.orgMemberships || []).map(membership => membership.orgId)
    if (orgIds.length === 0) {
      return []
    }

    const organizations = await this.organizationModel.find({
      _id: { $in: orgIds },
    }).lean().exec()

    const membershipMap = new Map(
      (user.orgMemberships || []).map(membership => [
        membership.orgId.toString(),
        membership,
      ]),
    )

    return organizations.map((org) => {
      const membership = membershipMap.get(org._id.toString())
      return {
        id: org._id.toString(),
        name: org.name,
        type: org.type,
        status: org.status,
        role: normalizeUserRole(membership?.role, UserRole.EMPLOYEE),
        joinedAt: membership?.joinedAt || null,
        isActive: user.orgId?.toString() === org._id.toString(),
      }
    })
  }

  async listPendingInvites(orgId: string) {
    const organization = await this.organizationModel.findById(
      this.toObjectId(orgId, 'orgId'),
    ).lean().exec()
    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    const now = new Date()
    await this.enterpriseInviteModel.updateMany(
      {
        orgId: organization._id,
        status: EnterpriseInviteStatus.PENDING,
        expiresAt: { $lte: now },
      },
      {
        $set: {
          status: EnterpriseInviteStatus.EXPIRED,
        },
      },
    ).exec()

    const invites = await this.enterpriseInviteModel.find({
      orgId: organization._id,
      status: EnterpriseInviteStatus.PENDING,
      expiresAt: { $gt: now },
    })
      .sort({ invitedAt: -1, createdAt: -1 })
      .lean()
      .exec()

    return invites.map(invite => ({
      id: invite._id.toString(),
      orgId: organization._id.toString(),
      orgName: organization.name,
      phone: invite.phone,
      role: normalizeUserRole(invite.role),
      status: invite.status,
      invitedAt: invite.invitedAt,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
    }))
  }

  private async findOrCreateUserByPhone(
    phone: string,
    options: {
      fallbackName: string
      defaultRole: UserRole
    },
  ) {
    let user = await this.userModel.findOne({ phone }).exec()
    let isNewUser = false
    const defaultRole = normalizeUserRole(options.defaultRole)

    if (!user) {
      isNewUser = true
      user = await this.userModel.create({
        phone,
        name: options.fallbackName,
        role: defaultRole,
        userType: McUserType.ENTERPRISE,
        orgId: null,
        orgMemberships: [],
        isActive: true,
        lastLoginAt: new Date(),
      })
    }

    return { user, isNewUser }
  }

  private async assignUserToOrg(
    user: MediaClawUser,
    orgId: string,
    role: UserRole,
    makeActive: boolean,
  ) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedRole = normalizeUserRole(role)
    const memberships = this.mergeMemberships(user.orgMemberships || [], orgId, normalizedRole)

    const updatedUser = await this.userModel.findByIdAndUpdate(
      user._id,
      {
        $set: {
          orgMemberships: memberships,
          orgId: makeActive ? normalizedOrgId : user.orgId,
          role: makeActive ? normalizedRole : normalizeUserRole(user.role),
          userType: McUserType.ENTERPRISE,
          isActive: true,
          lastLoginAt: new Date(),
        },
      },
      { new: true },
    ).exec()

    if (!updatedUser) {
      throw new NotFoundException('User not found')
    }

    return updatedUser
  }

  private mergeMemberships(
    memberships: OrgMembershipRecord[],
    orgId: string,
    role: UserRole,
  ) {
    const normalizedRole = normalizeUserRole(role)
    const existingIndex = memberships.findIndex(
      membership => membership.orgId.toString() === orgId,
    )

    if (existingIndex >= 0) {
      return memberships.map((membership, index) => {
        if (index !== existingIndex) {
          return membership
        }

        return {
          ...membership,
          role: normalizedRole,
        }
      })
    }

    return [
      ...memberships,
      {
        orgId: this.toObjectId(orgId, 'orgId'),
        role: normalizedRole,
        joinedAt: new Date(),
      },
    ]
  }

  private findMembership(user: MediaClawUser, orgId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId').toString()

    return (user.orgMemberships || []).find(
      membership => membership.orgId.toString() === normalizedOrgId,
    ) || null
  }

  private ensureValidRole(role: UserRole) {
    const normalizedRole = normalizeUserRole(role)
    if (!isEnterpriseAssignableRole(normalizedRole)) {
      throw new BadRequestException('Invalid role')
    }

    return normalizedRole
  }

  private hashInviteToken(token: string) {
    const normalizedToken = token?.trim()
    if (!normalizedToken) {
      throw new BadRequestException('token is required')
    }

    return createHash('sha256').update(normalizedToken).digest('hex')
  }

  private normalizeOptionalString(value?: string | null) {
    const normalized = value?.trim()
    return normalized ? normalized : null
  }

  private toOptionalObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private toOrgResponse(organization: OrganizationResponseInput) {
    return {
      id: organization._id.toString(),
      name: organization.name,
      type: organization.type,
      status: organization.status,
      billingMode: organization.billingMode,
      contactName: organization.contactName,
      contactPhone: organization.contactPhone,
      contactEmail: organization.contactEmail,
      monthlyQuota: organization.monthlyQuota,
      monthlyUsed: organization.monthlyUsed,
      subscriptionExpiresAt: organization.subscriptionExpiresAt,
      enterpriseProfile: {
        companyName: organization.enterpriseProfile?.companyName || organization.name,
        businessLicenseUrl: organization.enterpriseProfile?.businessLicenseUrl || '',
        unifiedSocialCreditCode: organization.enterpriseProfile?.unifiedSocialCreditCode || '',
        legalRepresentative: organization.enterpriseProfile?.legalRepresentative || '',
        registeredAddress: organization.enterpriseProfile?.registeredAddress || '',
        industry: organization.enterpriseProfile?.industry || '',
        officialWebsite: organization.enterpriseProfile?.officialWebsite || '',
        description: organization.enterpriseProfile?.description || '',
      },
    }
  }

  private toSubscriptionResponse(subscription: {
    _id: { toString: () => string }
    orgId: { toString: () => string }
    plan: SubscriptionPlan
    status: SubscriptionStatus
    billingMode: BillingMode
    monthlyFeeCents: number
    perVideoCents: number
    monthlyQuota: number
    monthlyUsed: number
    currentPeriodStart: Date
    currentPeriodEnd: Date
    autoRenew: boolean
  }) {
    return {
      id: subscription._id.toString(),
      orgId: subscription.orgId.toString(),
      plan: subscription.plan,
      status: subscription.status,
      billingMode: subscription.billingMode,
      monthlyFeeCents: subscription.monthlyFeeCents,
      perVideoCents: subscription.perVideoCents,
      monthlyQuota: subscription.monthlyQuota,
      monthlyUsed: subscription.monthlyUsed,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      autoRenew: subscription.autoRenew,
    }
  }
}
