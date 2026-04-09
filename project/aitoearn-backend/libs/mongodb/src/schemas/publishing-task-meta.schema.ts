import { Prop, Schema } from '@nestjs/mongoose'
import mongoose from 'mongoose'

const TIKTOK_PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'SELF_ONLY',
  'FOLLOWER_OF_CREATOR',
] as const

const META_CONTENT_CATEGORIES = ['post', 'reel', 'story'] as const

const YOUTUBE_PRIVACY_STATUSES = ['public', 'unlisted', 'private'] as const

const YOUTUBE_LICENSES = ['youtube', 'creativeCommon'] as const

@Schema({})
export class BiliBiliPublishTaskMeta {
  @Prop({ type: Number, required: true })
  tid: number

  @Prop({ type: Number, required: true })
  no_reprint: number

  @Prop({ type: Number, required: true })
  copyright: number

  @Prop({ type: String, required: false })
  source?: string
}

@Schema({})
export class TiktokPublishTaskMeta {
  @Prop({ type: String, required: true, enum: TIKTOK_PRIVACY_LEVELS })
  privacy_level: (typeof TIKTOK_PRIVACY_LEVELS)[number]

  @Prop({ type: Boolean, required: false })
  disable_duet?: boolean

  @Prop({ type: Boolean, required: false })
  disable_stitch?: boolean

  @Prop({ type: Boolean, required: false })
  disable_comment?: boolean

  @Prop({ type: Boolean, required: false })
  brand_organic_toggle?: boolean

  @Prop({ type: Boolean, required: false })
  brand_content_toggle?: boolean
}

@Schema({})
export class FacebookPublishTaskMeta {
  @Prop({ type: String, required: true, enum: META_CONTENT_CATEGORIES })
  content_category: (typeof META_CONTENT_CATEGORIES)[number]
}

@Schema({})
export class InstagramPublishTaskMeta {
  @Prop({ type: String, required: true, enum: META_CONTENT_CATEGORIES })
  content_category: (typeof META_CONTENT_CATEGORIES)[number]
}

@Schema({})
export class YoutubePublishTaskMeta {
  @Prop({ type: String, required: true, enum: YOUTUBE_PRIVACY_STATUSES })
  privacyStatus: (typeof YOUTUBE_PRIVACY_STATUSES)[number]

  @Prop({ type: String, required: true, enum: YOUTUBE_LICENSES })
  license: (typeof YOUTUBE_LICENSES)[number]

  @Prop({ type: String, required: true })
  categoryId: string
}

@Schema({})
export class PinterestPublishTaskMeta {
  @Prop({ type: String, required: true })
  boardId: string
}

@Schema({})
export class ThreadsPublishTaskMeta {
  @Prop({ type: String, required: false })
  reply_control?: string

  @Prop({ type: [String], required: false })
  allowlisted_country_codes?: string[]

  @Prop({ type: String, required: false })
  alt_text?: string

  @Prop({ type: Boolean, required: false })
  auto_publish_text?: boolean

  @Prop({ type: String, required: false })
  topic_tags?: string

  @Prop({ type: String, required: false })
  location_id?: string
}

@Schema({})
export class WxGzhPublishTaskMeta {
  @Prop({ type: Number, required: false })
  open_comment?: number

  @Prop({ type: Number, required: false })
  only_fans_can_comment?: number
}

@Schema({})
export class PublishingTaskMeta {
  @Prop({ type: BiliBiliPublishTaskMeta, required: false })
  bilibili?: BiliBiliPublishTaskMeta

  @Prop({ type: TiktokPublishTaskMeta, required: false })
  tiktok?: TiktokPublishTaskMeta

  @Prop({ type: FacebookPublishTaskMeta, required: false })
  facebook?: FacebookPublishTaskMeta

  @Prop({ type: InstagramPublishTaskMeta, required: false })
  instagram?: InstagramPublishTaskMeta

  @Prop({ type: YoutubePublishTaskMeta, required: false })
  youtube?: YoutubePublishTaskMeta

  @Prop({ type: PinterestPublishTaskMeta, required: false })
  pinterest?: PinterestPublishTaskMeta

  @Prop({ type: ThreadsPublishTaskMeta, required: false })
  threads?: ThreadsPublishTaskMeta

  @Prop({ type: WxGzhPublishTaskMeta, required: false })
  wxGzh?: WxGzhPublishTaskMeta
}

@Schema({})
export class PublishErrorData {
  @Prop({ type: String, required: true })
  type: string

  @Prop({ type: String, required: true })
  code: string

  @Prop({ type: String, required: true, default: '' })
  message: string

  @Prop({ required: false, type: mongoose.Schema.Types.Mixed })
  originalData?: Record<string, unknown>
}
