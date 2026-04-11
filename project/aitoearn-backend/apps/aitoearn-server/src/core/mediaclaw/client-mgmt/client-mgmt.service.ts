import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import {
  Brand,
  ClawHostDeploymentMode,
  ClawHostInstance,
  ClawHostInstanceStatus,
  Invoice,
  MediaClawUser,
  normalizeUserRole,
  Organization,
  OrgStatus,
  OrgType,
  SkillMarketplaceEntry,
  SkillMarketplaceEntryStatus,
  Subscription,
  SubscriptionStatus,
  UserRole,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { EnterpriseAuthService } from '../auth/enterprise-auth.service'
import { OrgMemberAdminService } from '../org/org-member-admin.service'
import {
  MEDIACLAW_PENDING_TASK_STATUSES,
  MEDIACLAW_SUCCESS_STATUSES,
} from '../video-task-status.utils'

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
    @Inject(getModelToken(Organization.name))
    private readonly organizationModel: Model<Organization>,
    @Inject(getModelToken(MediaClawUser.name))
    private readonly mediaClawUserModel: Model<MediaClawUser>,
    @Inject(getModelToken(Brand.name))
    private readonly brandModel: Model<Brand>,
    @Inject(getModelToken(VideoTask.name))
    private readonly videoTaskModel: Model<VideoTask>,
    @Inject(getModelToken(ClawHostInstance.name))
    private readonly clawHostInstanceModel: Model<ClawHostInstance>,
    @Inject(getModelToken(SkillMarketplaceEntry.name))
    private readonly skillMarketplaceEntryModel: Model<SkillMarketplaceEntry>,
    @Inject(getModelToken(Subscription.name))
    private readonly subscriptionModel: Model<Subscription>,
    @Inject(getModelToken(Invoice.name))
    private readonly invoiceModel: Model<Invoice>,
    private readonly enterpriseAuthService: EnterpriseAuthService,
    private readonly orgMemberAdminService: OrgMemberAdminService,
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
    const orgIds = items.map(org => new Types.ObjectId(String(org._id)))
    const [memberCounts, videoCounts, subscriptions] = orgIds.length > 0
      ? await Promise.all([
          this.mediaClawUserModel.aggregate<{
            _id: Types.ObjectId
            memberCount: number
          }>([
            {
              $match: {
                isActive: true,
              },
            },
            {
              $unwind: '$orgMemberships',
            },
            {
              $match: {
                'orgMemberships.orgId': { $in: orgIds },
              },
            },
            {
              $group: {
                _id: '$orgMemberships.orgId',
                memberCount: { $sum: 1 },
              },
            },
          ]),
          this.videoTaskModel.aggregate<{
            _id: Types.ObjectId
            videoCount: number
          }>([
            {
              $match: {
                orgId: { $in: orgIds },
              },
            },
            {
              $group: {
                _id: '$orgId',
                videoCount: { $sum: 1 },
              },
            },
          ]),
          this.subscriptionModel.aggregate<{
            _id: Types.ObjectId
            plan?: string
            billingMode?: string
          }>([
            {
              $match: {
                orgId: { $in: orgIds },
              },
            },
            {
              $sort: {
                orgId: 1,
                createdAt: -1,
              },
            },
            {
              $group: {
                _id: '$orgId',
                plan: { $first: '$plan' },
                billingMode: { $first: '$billingMode' },
              },
            },
          ]),
        ])
      : [[], [], []]

    const memberCountMap = new Map(
      memberCounts.map(item => [item._id.toString(), item.memberCount]),
    )
    const videoCountMap = new Map(
      videoCounts.map(item => [item._id.toString(), item.videoCount]),
    )
    const subscriptionMap = new Map(
      subscriptions.map(item => [
        item._id.toString(),
        item.plan || item.billingMode || null,
      ]),
    )

    return {
      items: items.map(org => ({
        id: org._id.toString(),
        name: org.name,
        plan: subscriptionMap.get(org._id.toString()) || org.billingMode || 'quota',
        type: org.type,
        status: org.status,
        billingMode: org.billingMode,
        memberCount: memberCountMap.get(org._id.toString()) || 0,
        videoCount: videoCountMap.get(org._id.toString()) || 0,
        contactName: org.contactName,
        contactPhone: org.contactPhone,
        contactEmail: org.contactEmail,
        monthlyQuota: org.monthlyQuota,
        monthlyUsed: org.monthlyUsed,
        subscriptionExpiresAt: org.subscriptionExpiresAt,
        enterpriseProfile: org.enterpriseProfile || null,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
      })),
      total,
      page,
      limit,
    }
  }

  async countVideosCreatedToday() {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    return this.videoTaskModel.countDocuments({
      createdAt: { $gte: startOfDay },
    })
  }

  async getPlatformOverview() {
    const [
      orgTotal,
      orgActive,
      orgTrial,
      orgSuspended,
      crossInstanceStatsEnabledOrgs,
      opsConsoleEnabledOrgs,
      skillMarketplaceEnabledOrgs,
      instanceTotal,
      instanceRunning,
      instanceManaged,
      instanceByoc,
      skillTotal,
      skillPublished,
      skillFeatured,
      usageAggregate,
      installAggregate,
    ] = await Promise.all([
      this.organizationModel.countDocuments({}),
      this.organizationModel.countDocuments({ status: OrgStatus.ACTIVE }),
      this.organizationModel.countDocuments({ status: OrgStatus.TRIAL }),
      this.organizationModel.countDocuments({ status: OrgStatus.SUSPENDED }),
      this.organizationModel.countDocuments({ 'platformLayer.strategy.enableCrossInstanceStats': true }),
      this.organizationModel.countDocuments({ 'platformLayer.strategy.enableOpsConsole': true }),
      this.organizationModel.countDocuments({ 'platformLayer.strategy.allowSkillMarketplace': true }),
      this.clawHostInstanceModel.countDocuments({}),
      this.clawHostInstanceModel.countDocuments({ status: ClawHostInstanceStatus.RUNNING }),
      this.clawHostInstanceModel.countDocuments({ deploymentMode: ClawHostDeploymentMode.MANAGED }),
      this.clawHostInstanceModel.countDocuments({ deploymentMode: ClawHostDeploymentMode.BYOC }),
      this.skillMarketplaceEntryModel.countDocuments({}),
      this.skillMarketplaceEntryModel.countDocuments({ status: SkillMarketplaceEntryStatus.PUBLISHED }),
      this.skillMarketplaceEntryModel.countDocuments({ isFeatured: true }),
      this.organizationModel.aggregate<{
        _id: null
        monthlyQuota: number
        monthlyUsed: number
      }>([
        {
          $group: {
            _id: null,
            monthlyQuota: { $sum: '$monthlyQuota' },
            monthlyUsed: { $sum: '$monthlyUsed' },
          },
        },
      ]),
      this.skillMarketplaceEntryModel.aggregate<{
        _id: null
        totalInstalls: number
        activeInstallCount: number
      }>([
        {
          $project: {
            installs: { $ifNull: ['$installs', 0] },
            activeInstallCount: {
              $size: {
                $filter: {
                  input: { $ifNull: ['$installHistory', []] },
                  as: 'item',
                  cond: {
                    $eq: ['$$item.uninstalledAt', null],
                  },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: null,
            totalInstalls: { $sum: '$installs' },
            activeInstallCount: { $sum: '$activeInstallCount' },
          },
        },
      ]),
    ])

    const usage = usageAggregate[0] || { monthlyQuota: 0, monthlyUsed: 0 }
    const installs = installAggregate[0] || { totalInstalls: 0, activeInstallCount: 0 }

    return {
      organizations: {
        total: orgTotal,
        active: orgActive,
        trial: orgTrial,
        suspended: orgSuspended,
      },
      platformPolicyCoverage: {
        crossInstanceStatsEnabledOrgs,
        opsConsoleEnabledOrgs,
        skillMarketplaceEnabledOrgs,
      },
      instances: {
        total: instanceTotal,
        running: instanceRunning,
        managed: instanceManaged,
        byoc: instanceByoc,
      },
      skills: {
        total: skillTotal,
        published: skillPublished,
        featured: skillFeatured,
        totalInstalls: installs.totalInstalls,
        activeInstallCount: installs.activeInstallCount,
      },
      usage: {
        monthlyQuota: usage.monthlyQuota,
        monthlyUsed: usage.monthlyUsed,
        utilizationRate: usage.monthlyQuota > 0
          ? Number(((usage.monthlyUsed / usage.monthlyQuota) * 100).toFixed(2))
          : 0,
      },
      updatedAt: new Date(),
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
      this.mediaClawUserModel.countDocuments({
        'orgMemberships.orgId': normalizedOrgId,
        'isActive': true,
      }),
      this.mediaClawUserModel.countDocuments({
        orgMemberships: {
          $elemMatch: {
            orgId: normalizedOrgId,
            role: {
              $in: [UserRole.ENTERPRISE_ADMIN, UserRole.SUPER_ADMIN],
            },
          },
        },
        isActive: true,
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
                $cond: [{ $in: ['$status', MEDIACLAW_SUCCESS_STATUSES] }, 1, 0],
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
                      MEDIACLAW_PENDING_TASK_STATUSES,
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
        enterpriseProfile: org.enterpriseProfile || null,
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
    return this.orgMemberAdminService.listMembers(orgId)
  }

  async listPendingInvites(orgId: string) {
    return this.enterpriseAuthService.listPendingInvites(orgId)
  }

  async updateMemberRole(orgId: string, userId: string, role: UserRole) {
    return this.orgMemberAdminService.updateMemberRole(orgId, userId, role)
  }

  async removeOrgMember(orgId: string, userId: string) {
    return this.orgMemberAdminService.removeMember(orgId, userId)
  }

  async inviteMember(orgId: string, phone: string, role: UserRole = UserRole.EMPLOYEE) {
    await this.ensureOrgExists(this.toObjectId(orgId, 'orgId'))
    return this.enterpriseAuthService.inviteByPhone(
      orgId,
      phone,
      this.normalizeEnterpriseRole(role),
    )
  }

  async revokeInvite(orgId: string, inviteId: string) {
    return this.enterpriseAuthService.revokeInvite(orgId, inviteId)
  }

  private buildOrgQuery(filters: OrgFilters) {
    const query: Record<string, unknown> = {}

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

  private normalizeEnterpriseRole(role: UserRole) {
    const normalizedRole = normalizeUserRole(role)
    if (normalizedRole === UserRole.SUPER_ADMIN) {
      throw new BadRequestException('Invalid user role')
    }

    return normalizedRole
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
