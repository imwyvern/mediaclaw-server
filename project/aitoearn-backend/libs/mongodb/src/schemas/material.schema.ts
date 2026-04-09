import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { AccountType, UserType } from '@yikart/common'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { FileMetadata, MediaType } from './media.schema'
import { WithTimestampSchema } from './timestamp.schema'

export enum MaterialType {
  VIDEO = 'video', // 视频
  ARTICLE = 'article', // 文章
}

export enum MaterialStatus {
  WAIT = 0,
  SUCCESS = 1,
  FAIL = -1,
}

/** 素材来源 */
export enum MaterialSource {
  UPLOAD = 'upload',
  GOOGLE_MAPS = 'google_maps',
  PlaceDraft = 'place_draft',
}

/** 品牌关联信息 */
@Schema({ _id: false })
export class MaterialBrandInfo {
  @Prop({ type: String, required: true, index: true })
  libraryId: string

  @Prop({ type: String, required: true })
  placeId: string

  @Prop({ type: String, required: false })
  photoReference?: string
}

@Schema({
  versionKey: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class MaterialMedia {
  @Prop({
    type: String,
    required: true,
  })
  url: string

  @Prop({
    type: String,
    required: false,
  })
  thumbUrl?: string // 缩略图

  @Prop({
    type: Object,
  })
  metadata?: FileMetadata

  @Prop({
    type: String,
    required: true,
  })
  type: MediaType

  @Prop({
    type: String,
    required: false,
    default: '',
  })
  content?: string

  @Prop({
    type: String,
    required: false,
  })
  mediaId?: string
}
@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'material' })
export class Material extends WithTimestampSchema {
  id: string

  @Prop({
    type: String,
    required: true,
    index: true,
  })
  userId: string

  @Prop({
    type: String,
    required: true,
    index: true,
    default: UserType.User,
  })
  userType: UserType

  @Prop({
    type: String,
    required: true,
    index: true,
  })
  groupId: string // 所属组ID

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  taskId?: string // 使用生成的任务ID

  /** 素材来源 */
  @Prop({
    type: String,
    required: true,
    enum: MaterialSource,
    default: MaterialSource.UPLOAD,
    index: true,
  })
  source: MaterialSource

  /** 品牌关联信息 */
  @Prop({ type: MaterialBrandInfo, required: false })
  brandInfo?: MaterialBrandInfo

  @Prop({
    type: String,
    required: true,
    enum: MaterialType,
    index: true,
  })
  type: MaterialType

  @Prop({
    type: String,
    required: false,
  })
  coverUrl?: string

  @Prop({
    required: true,
    type: [MaterialMedia],
    default: [],
  })
  mediaList: MaterialMedia[]

  @Prop({
    type: String,
    required: false,
  })
  title?: string

  @Prop({
    type: String,
    required: false,
  })
  desc?: string

  // 话题
  @Prop({
    required: true,
    type: [String],
    default: [],
  })
  topics: string[]

  @Prop({
    required: false,
    default: {},
    type: Object, // 明确指定类型为 Object
  })
  option?: Record<string, any>

  @Prop({
    type: Number,
    required: true,
    enum: MaterialStatus,
    default: MaterialStatus.SUCCESS,
  })
  status: MaterialStatus

  @Prop({
    type: String,
    required: false,
    default: '',
  })
  message?: string

  @Prop({
    type: Number,
    required: true,
    default: 0,
    index: true,
  })
  useCount: number

  @Prop({
    type: Number,
    required: false,
    index: true,
  })
  maxUseCount?: number

  // 是否自动删除素材
  @Prop({
    type: Boolean,
    required: true,
    default: false,
  })
  autoDeleteMedia: boolean

  // 是否开启推广
  @Prop({
    type: Boolean,
    required: true,
    default: true,
  })
  openAffiliate: boolean

  // 模型
  @Prop({
    type: String,
    required: false,
  })
  model?: string

  // 适用的频道类型
  @Prop({
    required: true,
    type: [String],
    enum: AccountType,
    default: [],
    index: true,
  })
  accountTypes: AccountType[]
}

export const MaterialSchema = SchemaFactory.createForClass(Material)

MaterialSchema.index({ 'userId': 1, 'brandInfo.placeId': 1 })
