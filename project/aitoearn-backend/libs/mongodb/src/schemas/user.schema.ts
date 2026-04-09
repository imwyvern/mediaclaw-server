import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { EarnInfoStatus, UserStatus, UserType } from '../enums'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class UserAiItemInfo {
  @Prop({ type: String, required: true })
  defaultModel: string

  @Prop({
    required: false,
    default: {},
    type: Object,
  })
  option?: Record<string, any>
}

@Schema({
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class UserAiInfo {
  @Prop({
    required: false,
    type: UserAiItemInfo,
  })
  image?: UserAiItemInfo

  @Prop({
    required: false,
    type: UserAiItemInfo,
  })
  edit?: UserAiItemInfo

  @Prop({
    required: false,
    type: UserAiItemInfo,
  })
  video?: UserAiItemInfo

  @Prop({
    required: false,
    type: UserAiItemInfo,
  })
  agent?: UserAiItemInfo
}

@Schema({
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class UserBackData {
  @Prop({
    type: String,
    required: false,
  })
  phone?: string

  @Prop({ type: String, required: false })
  wxOpenid?: string

  @Prop({ type: String, required: false })
  wxUnionid?: string
}

@Schema({
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class UserEarnInfo {
  @Prop({
    type: Number,
    required: true,
    enum: EarnInfoStatus,
    default: EarnInfoStatus.OPEN,
  })
  status: EarnInfoStatus

  @Prop({ type: Number, required: true })
  cycleInterval: number
}

@Schema({ _id: false })
export class UserLocation {
  @Prop({ type: Number, required: false })
  lat?: number // 纬度

  @Prop({ type: Number, required: false })
  lng?: number // 经度

  @Prop({ type: String, required: false })
  country?: string // 国家名称

  @Prop({ type: String, required: false })
  countryCode?: string // 国家代码

  @Prop({ type: String, required: false })
  city?: string // 城市名称

  @Prop({ type: String, required: false })
  cityCode?: string // 城市代码

  @Prop({ type: String, required: false })
  district?: string // 区/县名称

  @Prop({ type: String, required: false })
  districtCode?: string // 区/县代码
}

export class UserStorage {
  @Prop({
    type: Number,
    required: true,
    default: 500 * 1024 * 1024,
  })
  total: number // Total Storage (Bytes)

  @Prop({ type: Date, required: false })
  expiredAt?: Date
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'user' })
export class User extends WithTimestampSchema {
  id: string

  @Prop({
    type: String,
    required: true,
    default: '',
  })
  name: string

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  mail: string

  @Prop({
    type: String,
    required: false,
  })
  avatar?: string

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  phone?: string

  @Prop({
    type: String,
    required: false,
    select: false,
  })
  password?: string

  @Prop({
    type: String,
    required: false,
    select: false,
  })
  salt?: string

  @Prop({
    type: Number,
    required: true,
    enum: UserStatus,
    default: UserStatus.OPEN,
  })
  status: UserStatus

  @Prop({
    type: String,
    required: true,
    enum: UserType,
    default: UserType.CREATOR,
    index: true,
  })
  userType: UserType

  // Is Deleted
  @Prop({
    type: Boolean,
    required: true,
    default: false,
    index: true,
  })
  isDelete: boolean

  @Prop({ type: String, required: false })
  wxOpenid?: string

  @Prop({ type: String, required: false })
  wxUnionid?: string

  @Prop({ type: String, required: false })
  popularizeCode?: string // My Promotion Code

  @Prop({ type: String, required: false })
  inviteUserId?: string // Inviter User ID

  @Prop({ type: String, required: false })
  inviteCode?: string // Invite Code Entered

  @Prop({ type: Object, required: false, default: {} })
  backData?: UserBackData

  @Prop({ type: Object, required: false, default: {} })
  earnInfo?: UserEarnInfo

  @Prop({ type: Object, required: false })
  googleAccount?: Record<string, unknown> // Google Account Info

  @Prop({
    type: Number,
    required: true,
    default: 0,
  })
  score: number // Score

  @Prop({
    type: Number,
    required: true,
    default: 0,
  })
  usedStorage: number // 已用存储（Bytes）

  @Prop({
    type: UserStorage,
    required: true,
    default: {
      total: 500 * 1024 * 1024,
    },
  })
  storage: UserStorage

  @Prop({
    type: Number,
    required: false,
    default: 0,
  })
  tenDayExpPoint: number

  @Prop({
    required: false,
    type: UserAiInfo,
  })
  aiInfo?: UserAiInfo

  @Prop({ required: false, type: UserLocation })
  location?: UserLocation // 用户位置信息

  @Prop({ type: String, required: false, default: 'en-US' })
  locale?: string // 用户语言偏好 (en-US | zh-CN)

  @Prop({ type: String, required: false, index: true })
  placeId?: string

  @Prop({ type: String, required: false, index: true })
  libraryId?: string
}

export const UserSchema = SchemaFactory.createForClass(User)
