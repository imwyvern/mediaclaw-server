/*
 * @Author: nevin
 * @Date: 2024-09-02 14:45:57
 * @LastEditTime: 2025-02-22 12:37:22
 * @LastEditors: nevin
 * @Description: 媒体库 mediaGroup
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { MediaType } from './media.schema'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'mediaGroup' })
export class MediaGroup extends WithTimestampSchema {
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
    enum: MediaType,
    index: true,
  })
  type: MediaType

  @Prop({
    type: String,
    required: true,
  })
  title: string

  @Prop({
    type: String,
    required: false,
  })
  desc?: string

  // 是否默认
  @Prop({
    type: Boolean,
    required: true,
    index: true,
    default: false,
  })
  isDefault: boolean
}

export const MediaGroupSchema = SchemaFactory.createForClass(MediaGroup)
