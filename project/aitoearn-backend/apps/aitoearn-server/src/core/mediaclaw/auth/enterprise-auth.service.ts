import { randomBytes } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  BillingMode,
  McUserType,
  MediaClawUser,
  OrgStatus,
  OrgType,
  Organization,
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
  UserRole,
} from '@yikart/mongodb'
import { McAuthService } from './auth.service'

interface EnterpriseInviteRecord {
  token: string
  orgId: string
  phone: string
  role: UserRole
  expiresAt: number
  invitedAt: string
}

interface RegisterEnterpriseInput {
  orgName: string
  adminPhone: string
  adminName?: string
  contactEmail?: string
  contactName?: string
  monthlyQuota?: number
}

@Injectable()
export class EnterpriseAuthService {
  private readonly inviteStore = new Map<string, EnterpriseInviteRecord>()

  constructor(
    @InjectModel(MediaClawUser.name)
    private readonly userModel: Model<MediaClawUser>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
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
      settings: {},
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

    const { user, isNewUser } = await this.findOrCreateUserByPhone(data.adminPhone, {
      fallbackName: data.adminName?.trim() || `${orgName}管理员`,
      defaultRole: UserRole.ADMIN,
    })

    const updatedUser = await this.assignUserToOrg(
      user,
      organization._id.toString(),
      UserRole.ADMIN,
      true,
    )

    return {
      organization: this.toOrgResponse(organization.toObject()),
      subscription: this.toSubscriptionResponse(subscription.toObject()),
      ...this.authService.buildAuthResult(updatedUser, isNewUser),
    }
  }

  async inviteByPhone(orgId: string, phone: string, role: UserRole) {
    const organization = await this.organizationModel.findById(this.toObjectId(orgId, 'orgId')).exec()
    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    this.authService.validatePhoneNumber(phone)
    this.ensureValidRole(role)

    await this.authService.sendSmsCode(phone)

    const token = randomBytes(24).toString('hex')
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000
    const inviteRecord: EnterpriseInviteRecord = {
      token,
      orgId: organization._id.toString(),
      phone,
      role,
      expiresAt,
      invitedAt: new Date().toISOString(),
    }

    this.inviteStore.set(token, inviteRecord)

    return {
      token,
      orgId: organization._id.toString(),
      orgName: organization.name,
      phone,
      role,
      expiresAt: new Date(expiresAt).toISOString(),
      inviteSent: true,
    }
  }

  async acceptInvite(token: string, phone: string, code: string) {
    const inviteRecord = this.inviteStore.get(token)
    if (!inviteRecord || inviteRecord.expiresAt < Date.now()) {
      throw new BadRequestException('Invite token is invalid or expired')
    }

    if (inviteRecord.phone !== phone) {
      throw new BadRequestException('Invite token does not match phone number')
    }

    const organization = await this.organizationModel.findById(inviteRecord.orgId).exec()
    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    await this.authService.consumeSmsCode(phone, code)

    const { user, isNewUser } = await this.findOrCreateUserByPhone(phone, {
      fallbackName: `${organization.name}成员`,
      defaultRole: inviteRecord.role,
    })

    const updatedUser = await this.assignUserToOrg(
      user,
      organization._id.toString(),
      inviteRecord.role,
      true,
    )

    this.inviteStore.delete(token)

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
          role: membership.role,
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

    return organizations.map(org => {
      const membership = membershipMap.get(org._id.toString())
      return {
        id: org._id.toString(),
        name: org.name,
        type: org.type,
        status: org.status,
        role: membership?.role || UserRole.VIEWER,
        joinedAt: membership?.joinedAt || null,
        isActive: user.orgId?.toString() === org._id.toString(),
      }
    })
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

    if (!user) {
      isNewUser = true
      user = await this.userModel.create({
        phone,
        name: options.fallbackName,
        role: options.defaultRole,
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
    const memberships = this.mergeMemberships(user.orgMemberships || [], orgId, role)

    const updatedUser = await this.userModel.findByIdAndUpdate(
      user._id,
      {
        $set: {
          orgMemberships: memberships,
          orgId: makeActive ? normalizedOrgId : user.orgId,
          role: makeActive ? role : user.role,
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
    memberships: Array<{
      orgId: { toString(): string }
      role: UserRole
      joinedAt: Date
    }>,
    orgId: string,
    role: UserRole,
  ) {
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
          role,
        }
      })
    }

    return [
      ...memberships,
      {
        orgId: this.toObjectId(orgId, 'orgId'),
        role,
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
    if (!Object.values(UserRole).includes(role)) {
      throw new BadRequestException('Invalid role')
    }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private toOrgResponse(organization: {
    _id: { toString(): string }
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
  }) {
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
    }
  }

  private toSubscriptionResponse(subscription: {
    _id: { toString(): string }
    orgId: { toString(): string }
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
