import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ _id: false })
class CrawlerMetricsSnapshot {
  @Prop({ type: Number, default: 0 })
  views: number

  @Prop({ type: Number, default: 0 })
  likes: number

  @Prop({ type: Number, default: 0 })
  comments: number

  @Prop({ type: Number, default: 0 })
  shares: number
}

@Schema({ _id: false })
class CrawlerVideoSnapshot {
  @Prop({ type: String, default: '' })
  platform: string

  @Prop({ type: String, default: '' })
  videoId: string

  @Prop({ type: String, default: '' })
  title: string

  @Prop({ type: String, default: '' })
  author: string

  @Prop({ type: String, default: '' })
  contentUrl: string

  @Prop({ type: String, default: '' })
  thumbnailUrl: string

  @Prop({ type: String, default: '' })
  publishedAt: string

  @Prop({ type: CrawlerMetricsSnapshot, default: () => ({}) })
  metrics: CrawlerMetricsSnapshot
}

@Schema({ _id: false })
class CrawlerComment {
  @Prop({ type: String, default: '' })
  commentId: string

  @Prop({ type: String, default: '' })
  author: string

  @Prop({ type: String, default: '' })
  content: string

  @Prop({ type: Number, default: 0 })
  likeCount: number

  @Prop({ type: Number, default: 0 })
  replyCount: number

  @Prop({ type: String, default: '' })
  publishedAt: string
}

@Schema({ _id: false })
class CrawlerCreatorProfile {
  @Prop({ type: String, default: '' })
  creatorId: string

  @Prop({ type: String, default: '' })
  nickname: string

  @Prop({ type: String, default: '' })
  avatarUrl: string

  @Prop({ type: Number, default: 0 })
  followerCount: number

  @Prop({ type: Number, default: 0 })
  followingCount: number

  @Prop({ type: Number, default: 0 })
  likeCount: number

  @Prop({ type: String, default: '' })
  bio: string

  @Prop({ type: String, default: '' })
  profileUrl: string
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'crawler_results' })
export class CrawlerResult extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, unique: true, index: true })
  jobId: string

  @Prop({ required: true, type: String, index: true })
  crawlType: string

  @Prop({ required: true, type: String, default: 'queued', index: true })
  status: string

  @Prop({ type: String, default: '', index: true })
  platform: string

  @Prop({ type: String, default: '' })
  keyword: string

  @Prop({ type: Number, default: 1 })
  depth: number

  @Prop({ type: Number, default: 0 })
  resultLimit: number

  @Prop({ type: String, default: '', index: true })
  industry: string

  @Prop({ type: [String], default: [] })
  keywords: string[]

  @Prop({ type: String, default: '', index: true })
  source: string

  @Prop({ type: String, default: '' })
  routeMode: string

  @Prop({ type: String, default: '' })
  targetId: string

  @Prop({ type: String, default: '' })
  targetUrl: string

  @Prop({ type: String, default: '' })
  creatorId: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  competitorId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: [CrawlerVideoSnapshot], default: [] })
  seededResults: CrawlerVideoSnapshot[]

  @Prop({ type: [CrawlerComment], default: [] })
  comments: CrawlerComment[]

  @Prop({ type: CrawlerCreatorProfile, default: null })
  creatorProfile: CrawlerCreatorProfile | null

  @Prop({ type: [CrawlerVideoSnapshot], default: [] })
  recentPosts: CrawlerVideoSnapshot[]

  @Prop({ type: [String], default: [] })
  contentIds: string[]

  @Prop({ type: Object, default: null })
  route: Record<string, unknown> | null

  @Prop({ type: Object, default: null })
  persisted: Record<string, unknown> | null

  @Prop({ type: Object, default: null })
  supplementalDispatch: Record<string, unknown> | null

  @Prop({ type: Object, default: null })
  supplementalPersisted: Record<string, unknown> | null

  @Prop({ type: [Object], default: [] })
  analysisItems: Record<string, unknown>[]

  @Prop({ type: String, default: '' })
  error: string

  @Prop({ type: Date, default: null })
  completedAt: Date | null
}

export const CrawlerResultSchema = SchemaFactory.createForClass(CrawlerResult)

CrawlerResultSchema.index({ platform: 1, crawlType: 1, createdAt: -1 })
CrawlerResultSchema.index({ competitorId: 1, createdAt: -1 })
CrawlerResultSchema.index({ orgId: 1, createdAt: -1 })
