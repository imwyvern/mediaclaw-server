import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Brand,
  Invoice,
  McUserType,
  MediaClawUser,
  Organization,
  OrgStatus,
  OrgType,
  Subscription,
  SubscriptionStatus,
  UserRole,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

interface OrgFilters {
  status?: OrgStatus
  type?: OrgType
  keyword?: string
}

interface PaginationInput {
  page?: number
  limit?: number
}

@Injectable()
export class ClientMgmtService {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(MediaClawUser.name)
    private readonly mediaClawUserModel: Model<MediaClawUser>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<Invoice>,
  ) {}

  async listOrgs(filters: OrgFilters, pagination: PaginationInput) {
    const page = this.normalizePage(pagination.page)
    const limit = this.normalizeLimit(pagination.limit)
    const skip = (page - 1) * limit
    const query = this.buildOrgQuery(filters)

    const [items, total] = await Promise.all([
      this.organizationModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.organizationModel.countDocuments(query),
    ])

    return {
      items: items.map(org => ({
        id: org._id.toString(),
        name: org.name,
        type: org.type,
        status: org.status,
        billingMode: org.billingMode,
        contactName: org.contactName,
        contactPhone: org.contactPhone,
        contactEmail: org.contactEmail,
        monthlyQuota: org.monthlyQuota,
        monthlyUsed: org.monthlyUsed,
        subscriptionExpiresAt: org.subscriptionExpiresAt,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
      })),
      total,
      page,
      limit,
    }
  }

  async getOrgDetail(orgId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const org = await this.organizationModel.findById(normalizedOrgId).lean().exec()

    if (!org) {
      throw new NotFoundException('Organization not found')
    }

    const [
      memberCount,
      adminCount,
      activeBrandCount,
      taskStats,
      activeSubscription,
      latestInvoice,
    ] = await Promise.all([
      this.mediaClawUserModel.countDocuments({ orgId: normalizedOrgId, isActive: true }),
      this.mediaClawUserModel.countDocuments({
        orgId: normalizedOrgId,
        isActive: true,
        role: UserRole.ADMIN,
      }),
      this.brandModel.countDocuments({ orgId: normalizedOrgId, isActive: true }),
      this.videoTaskModel.aggregate<{
        totalTasks: number
        completedTasks: number
        failedTasks: number
        pendingTasks: number
      }>([
        { $match: { orgId: normalizedOrgId } },
        {
          $group: {
            _id: null,
            totalTasks: { $sum: 1 },
            completedTasks: {
              $sum: {
                $cond: [{ $eq: ['$status', VideoTaskStatus.COMPLETED] }, 1, 0],
              },
            },
            failedTasks: {
              $sum: {
                $cond: [{ $eq: ['$status', VideoTaskStatus.FAILED] }, 1, 0],
              },
            },
            pendingTasks: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      '$status',
                      [
                        VideoTaskStatus.PENDING,
                        VideoTaskStatus.ANALYZING,
                        VideoTaskStatus.EDITING,
                        VideoTaskStatus.RENDERING,
                        VideoTaskStatus.QUALITY_CHECK,
                        VideoTaskStatus.GENERATING_COPY,
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      this.subscriptionModel
        .findOne({
          orgId: normalizedOrgId,
          status: {
            $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
          },
        })
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.invoiceModel
        .findOne({ orgId: normalizedOrgId })
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
    ])

    return {
      org: {
        id: org._id.toString(),
        name: org.name,
        type: org.type,
        status: org.status,
        billingMode: org.billingMode,
        contactName: org.contactName,
        contactPhone: org.contactPhone,
        contactEmail: org.contactEmail,
        monthlyQuota: org.monthlyQuota,
        monthlyUsed: org.monthlyUsed,
        subscriptionExpiresAt: org.subscriptionExpiresAt,
        settings: org.settings,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
      },
      stats: {
        members: memberCount,
        admins: adminCount,
        activeBrands: activeBrandCount,
        totalTasks: taskStats[0]?.totalTasks || 0,
        completedTasks: taskStats[0]?.completedTasks || 0,
        failedTasks: taskStats[0]?.failedTasks || 0,
        pendingTasks: taskStats[0]?.pendingTasks || 0,
      },
      subscription: activeSubscription
        ? {
            id: activeSubscription._id.toString(),
            plan: activeSubscription.plan,
            status: activeSubscription.status,
            billingMode: activeSubscription.billingMode,
            monthlyFeeCents: activeSubscription.monthlyFeeCents,
            perVideoCents: activeSubscription.perVideoCents,
            monthlyQuota: activeSubscription.monthlyQuota,
            monthlyUsed: activeSubscription.monthlyUsed,
            currentPeriodStart: activeSubscription.currentPeriodStart,
            currentPeriodEnd: activeSubscription.currentPeriodEnd,
          }
        : null,
      latestInvoice: latestInvoice
        ? {
            id: latestInvoice._id.toString(),
            invoiceNo: latestInvoice.invoiceNo,
            status: latestInvoice.status,
            totalCents: latestInvoice.totalCents,
            periodStart: latestInvoice.periodStart,
            periodEnd: latestInvoice.periodEnd,
            dueDate: latestInvoice.dueDate,
            paidAt: latestInvoice.paidAt,
          }
        : null,
    }
  }

  async updateOrgStatus(orgId: string, status: OrgStatus) {
    if (!Object.values(OrgStatus).includes(status)) {
      throw new BadRequestException('Invalid organization status')
    }

    const updated = await this.organizationModel
      .findByIdAndUpdate(
        this.toObjectId(orgId, 'orgId'),
        { status },
        { new: true },
      )
      .lean()
      .exec()

    if (!updated) {
      throw new NotFoundException('Organization not found')
    }

    return {
      id: updated._id.toString(),
      status: updated.status,
      updatedAt: updated.updatedAt,
    }
  }

  async listOrgMembers(orgId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    await this.ensureOrgExists(normalizedOrgId)

    const members = await this.mediaClawUserModel
      .find({ orgId: normalizedOrgId })
      .sort({ createdAt: 1 })
      .lean()
      .exec()

    return members.map(member => ({
      id: member._id.toString(),
      phone: member.phone,
      email: member.email,
      name: member.name,
      avatarUrl: member.avatarUrl,
      role: member.role,
      userType: member.userType,
      isActive: member.isActive,
      lastLoginAt: member.lastLoginAt,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    }))
  }

  async updateMemberRole(orgId: string, userId: string, role: UserRole) {
    if (!Object.values(UserRole).includes(role)) {
      throw new BadRequestException('Invalid user role')
    }

    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedUserId = this.toObjectId(userId, 'userId')
    await this.ensureOrgExists(normalizedOrgId)

    const member = await this.mediaClawUserModel
      .findOneAndUpdate(
        { _id: normalizedUserId, orgId: normalizedOrgId },
        { role },
        { new: true },
      )
      .lean()
      .exec()

    if (!member) {
      throw new NotFoundException('Organization member not found')
    }

    return {
      id: member._id.toString(),
      orgId: member.orgId?.toString() || null,
      role: member.role,
      updatedAt: member.updatedAt,
    }
  }

  async removeOrgMember(orgId: string, userId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedUserId = this.toObjectId(userId, 'userId')
    await this.ensureOrgExists(normalizedOrgId)

    const member = await this.mediaClawUserModel
      .findOneAndUpdate(
        { _id: normalizedUserId, orgId: normalizedOrgId },
        {
          orgId: null,
          role: UserRole.VIEWER,
          userType: McUserType.INDIVIDUAL,
        },
        { new: true },
      )
      .lean()
      .exec()

    if (!member) {
      throw new NotFoundException('Organization member not found')
    }

    return {
      id: member._id.toString(),
      removed: true,
    }
  }

  async inviteMember(orgId: string, phone: string, role: UserRole = UserRole.VIEWER) {
    if (!/^1\d{10}$/.test(phone)) {
      throw new BadRequestException('Invalid phone number')
    }
    if (!Object.values(UserRole).includes(role)) {
      throw new BadRequestException('Invalid user role')
    }

    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    await this.ensureOrgExists(normalizedOrgId)

    const existing = await this.mediaClawUserModel.findOne({ phone }).lean().exec()

    if (existing?.orgId && existing.orgId.toString() !== normalizedOrgId.toString()) {
      throw new BadRequestException('User already belongs to another organization')
    }

    const user = await this.mediaClawUserModel
      .findOneAndUpdate(
        { phone },
        {
          $set: {
            orgId: normalizedOrgId,
            role,
            userType: McUserType.ENTERPRISE,
            isActive: true,
          },
          $setOnInsert: {
            name: `用户${phone.slice(-4)}`,
            phone,
            email: '',
            avatarUrl: '',
            lastLoginAt: null,
          },
        },
        {
          new: true,
          upsert: true,
        },
      )
      .lean()
      .exec()

    return {
      id: user._id.toString(),
      orgId: user.orgId?.toString() || null,
      phone: user.phone,
      name: user.name,
      role: user.role,
      created: !existing,
    }
  }

  private buildOrgQuery(filters: OrgFilters) {
    const query: Record<string, any> = {}

    if (filters.status) {
      query['status'] = filters.status
    }

    if (filters.type) {
      query['type'] = filters.type
    }

    const keyword = filters.keyword?.trim()
    if (keyword) {
      query['$or'] = [
        { name: { $regex: keyword, $options: 'i' } },
        { contactName: { $regex: keyword, $options: 'i' } },
        { contactPhone: { $regex: keyword, $options: 'i' } },
        { contactEmail: { $regex: keyword, $options: 'i' } },
      ]
    }

    return query
  }

  private normalizePage(page?: number) {
    return Math.max(1, Math.trunc(Number(page) || 1))
  }

  private normalizeLimit(limit?: number) {
    return Math.max(1, Math.min(Math.trunc(Number(limit) || 20), 100))
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private async ensureOrgExists(orgId: Types.ObjectId) {
    const exists = await this.organizationModel.exists({ _id: orgId })
    if (!exists) {
      throw new NotFoundException('Organization not found')
    }
  }
}
