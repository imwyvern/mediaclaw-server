import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ENTERPRISE_ADMIN = 'admin',
  OPERATOR = 'editor',
  EMPLOYEE = 'viewer',
  ADMIN = 'admin',
  EDITOR = 'editor',
  VIEWER = 'viewer',
}

export const USER_ROLE_STORAGE_VALUES = Array.from(new Set(Object.values(UserRole)))

export const ENTERPRISE_USER_ROLES = [
  UserRole.ENTERPRISE_ADMIN,
  UserRole.OPERATOR,
  UserRole.EMPLOYEE,
] as const

const USER_ROLE_RANKS: Record<string, number> = {
  [UserRole.SUPER_ADMIN]: 400,
  [UserRole.ENTERPRISE_ADMIN]: 300,
  [UserRole.OPERATOR]: 200,
  [UserRole.EMPLOYEE]: 100,
}

export function normalizeUserRole(
  role: string | null | undefined,
  fallback: UserRole = UserRole.EMPLOYEE,
) {
  if (!role) {
    return fallback
  }

  const normalized = role.trim()
  if (!normalized) {
    return fallback
  }

  if (normalized === UserRole.SUPER_ADMIN) {
    return UserRole.SUPER_ADMIN
  }

  if (normalized === UserRole.ENTERPRISE_ADMIN || normalized === UserRole.ADMIN) {
    return UserRole.ENTERPRISE_ADMIN
  }

  if (normalized === UserRole.OPERATOR || normalized === UserRole.EDITOR) {
    return UserRole.OPERATOR
  }

  if (normalized === UserRole.EMPLOYEE || normalized === UserRole.VIEWER) {
    return UserRole.EMPLOYEE
  }

  return fallback
}

export function userRoleRank(role: string | null | undefined) {
  return USER_ROLE_RANKS[normalizeUserRole(role)] || USER_ROLE_RANKS[UserRole.EMPLOYEE]
}

export function userRoleSatisfies(
  role: string | null | undefined,
  requiredRole: string | UserRole,
) {
  return userRoleRank(role) >= userRoleRank(requiredRole)
}

export function isEnterpriseAssignableRole(role: string | null | undefined) {
  const normalized = normalizeUserRole(role)
  return ENTERPRISE_USER_ROLES.includes(
    normalized as (typeof ENTERPRISE_USER_ROLES)[number],
  )
}

export enum McUserType {
  INDIVIDUAL = 'individual',
  ENTERPRISE = 'enterprise',
}

@Schema({ _id: false })
export class OrgMembership {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ type: String, enum: USER_ROLE_STORAGE_VALUES, default: UserRole.EMPLOYEE })
  role: UserRole

  @Prop({ type: Date, default: Date.now })
  joinedAt: Date
}

@Schema({ _id: false })
class ImBinding {
  @Prop({ type: String, required: true })
  platform: string

  @Prop({ type: String, required: true })
  platformUserId: string

  @Prop({ type: String, default: '' })
  displayName: string

  @Prop({ type: Date, default: Date.now })
  boundAt: Date
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'mediaclaw_users' })
export class MediaClawUser extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ type: String, index: true })
  phone?: string

  @Prop({ type: String, default: '' })
  email: string

  @Prop({ type: String, default: '' })
  name: string

  @Prop({ type: String, default: '' })
  avatarUrl: string

  @Prop({ type: String, index: true })
  wechatOpenId?: string

  @Prop({ type: String, index: true })
  wechatUnionId?: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: String, enum: USER_ROLE_STORAGE_VALUES, default: UserRole.EMPLOYEE })
  role: UserRole

  @Prop({ type: String, enum: McUserType, default: McUserType.INDIVIDUAL })
  userType: McUserType

  @Prop({ type: [OrgMembership], default: [] })
  orgMemberships: OrgMembership[]

  @Prop({ type: [ImBinding], default: [] })
  imBindings: ImBinding[]

  @Prop({ type: String, default: '' })
  supabaseUserId: string

  @Prop({ type: Boolean, default: true })
  isActive: boolean

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null
}

export const MediaClawUserSchema = SchemaFactory.createForClass(MediaClawUser)
MediaClawUserSchema.index({ phone: 1 }, { unique: true, sparse: true })
MediaClawUserSchema.index({ email: 1 }, { sparse: true })
MediaClawUserSchema.index({ wechatOpenId: 1 }, { unique: true, sparse: true })
MediaClawUserSchema.index({ wechatUnionId: 1 }, { unique: true, sparse: true })
MediaClawUserSchema.index({ 'orgMemberships.orgId': 1 })
MediaClawUserSchema.index({ 'imBindings.platform': 1, 'imBindings.platformUserId': 1 })
