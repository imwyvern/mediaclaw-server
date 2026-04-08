import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  McUserType,
  MediaClawUser,
  normalizeUserRole,
  Organization,
  UserRole,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

@Injectable()
export class OrgMemberAdminService {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(MediaClawUser.name)
    private readonly mediaClawUserModel: Model<MediaClawUser>,
  ) {}

  async listMembers(orgId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    await this.ensureOrgExists(normalizedOrgId)

    const members = await this.mediaClawUserModel.find({
      'isActive': true,
      'orgMemberships.orgId': normalizedOrgId,
    })
      .sort({ role: 1, createdAt: 1 })
      .lean()
      .exec()

    return members.map(member => this.serializeMember(member, normalizedOrgId))
  }

  async updateMemberRole(orgId: string, userId: string, role: UserRole) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedUserId = this.toObjectId(userId, 'userId')
    const normalizedRole = this.normalizeEnterpriseRole(role)
    await this.ensureOrgExists(normalizedOrgId)

    const member = await this.mediaClawUserModel
      .findOne({
        '_id': normalizedUserId,
        'orgMemberships.orgId': normalizedOrgId,
      })
      .exec()

    if (!member) {
      throw new NotFoundException('Organization member not found')
    }

    member.orgMemberships = (member.orgMemberships || []).map((membership) => {
      if (membership.orgId.toString() !== normalizedOrgId.toString()) {
        return membership
      }

      return {
        ...membership,
        role: normalizedRole,
      }
    })

    if (member.orgId?.toString() === normalizedOrgId.toString()) {
      member.role = normalizedRole
    }

    await member.save()

    return {
      id: member._id.toString(),
      orgId: member.orgId?.toString() || null,
      role: normalizedRole,
      updatedAt: member.updatedAt,
    }
  }

  async removeMember(orgId: string, userId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedUserId = this.toObjectId(userId, 'userId')
    await this.ensureOrgExists(normalizedOrgId)

    const member = await this.mediaClawUserModel
      .findOne({
        '_id': normalizedUserId,
        'orgMemberships.orgId': normalizedOrgId,
      })
      .exec()

    if (!member) {
      throw new NotFoundException('Organization member not found')
    }

    member.orgMemberships = (member.orgMemberships || []).filter(
      membership => membership.orgId.toString() !== normalizedOrgId.toString(),
    )

    const nextMembership = member.orgMemberships[0] || null
    if (member.orgId?.toString() === normalizedOrgId.toString()) {
      member.orgId = nextMembership?.orgId || null
      member.role = nextMembership
        ? normalizeUserRole(nextMembership.role)
        : UserRole.EMPLOYEE
      member.userType = nextMembership ? McUserType.ENTERPRISE : McUserType.INDIVIDUAL
    }

    if (!member.orgMemberships.length && !member.orgId) {
      member.userType = McUserType.INDIVIDUAL
      member.role = UserRole.EMPLOYEE
    }

    await member.save()

    return {
      id: member._id.toString(),
      removed: true,
    }
  }

  private serializeMember(member: Record<string, any>, orgId: Types.ObjectId) {
    const membership = Array.isArray(member['orgMemberships'])
      ? member['orgMemberships'].find(
          item => item?.orgId?.toString?.() === orgId.toString(),
        )
      : null
    const role = normalizeUserRole(membership?.role || member['role'])

    return {
      id: member['_id']?.toString?.() || '',
      orgId: orgId.toString(),
      phone: member['phone'] || '',
      email: member['email'] || '',
      name: member['name'] || member['phone'] || '未命名成员',
      avatarUrl: member['avatarUrl'] || '',
      wechatId: member['wechatOpenId'] || '',
      userType: member['userType'] || '',
      role,
      isActive: member['isActive'] !== false,
      joinedAt: membership?.joinedAt || null,
      lastLoginAt: member['lastLoginAt'] || null,
      createdAt: member['createdAt'] || null,
      updatedAt: member['updatedAt'] || null,
    }
  }

  private normalizeEnterpriseRole(role: UserRole) {
    const normalizedRole = normalizeUserRole(role)
    if (normalizedRole === UserRole.SUPER_ADMIN) {
      throw new BadRequestException('Invalid user role')
    }

    return normalizedRole
  }

  private async ensureOrgExists(orgId: Types.ObjectId) {
    const exists = await this.organizationModel.exists({ _id: orgId })
    if (!exists) {
      throw new NotFoundException('Organization not found')
    }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }
}
