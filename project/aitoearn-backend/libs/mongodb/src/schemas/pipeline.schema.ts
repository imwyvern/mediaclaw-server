import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema } from "mongoose";

import { DEFAULT_SCHEMA_OPTIONS } from "../mongodb.constants";
import { WithTimestampSchema } from "./timestamp.schema";

export enum PipelineType {
  SEEDING = "seeding",
  REVIEW = "review",
  NEW_PRODUCT = "new_product",
  BRAND_STORY = "brand_story",
  PROMO = "promo",
}

export enum PipelineStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  ARCHIVED = "archived",
}

@Schema({ _id: false })
class PipelinePreferences {
  @Prop({ type: [String], default: [] })
  preferredStyles: string[];

  @Prop({ type: [String], default: [] })
  avoidStyles: string[];

  @Prop({ type: Number, default: 15 })
  preferredDuration: number;

  @Prop({ type: String, default: "9:16" })
  aspectRatio: string;

  @Prop({ type: Object, default: {} })
  subtitlePreferences: Record<string, any>;

  @Prop({ type: Object, default: {} })
  remixInsights: Record<string, any>;

  @Prop({ type: Number, default: 0 })
  feedbackCount: number;
}

@Schema({ _id: false })
class ScheduleConfig {
  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  @Prop({ type: String, default: "0 9 * * 1-5" })
  cron: string;

  @Prop({ type: Number, default: 1 })
  videosPerRun: number;

  @Prop({ type: String, default: "Asia/Shanghai" })
  timezone: string;
}

@Schema({ _id: false })
class PipelineDispatchRules {
  @Prop({ type: [String], default: [] })
  assignmentIds: string[];

  @Prop({ type: [String], default: [] })
  preferredPlatforms: string[];

  @Prop({ type: [String], default: [] })
  preferredCategories: string[];

  @Prop({ type: String, default: "round-robin" })
  strategy: string;
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: "pipelines" })
export class Pipeline extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  brandId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, type: String })
  name: string;

  @Prop({ type: String, enum: PipelineType, default: PipelineType.SEEDING })
  type: PipelineType;

  @Prop({
    type: String,
    enum: PipelineStatus,
    default: PipelineStatus.ACTIVE,
    index: true,
  })
  status: PipelineStatus;

  @Prop({ type: String, default: "" })
  description: string;

  @Prop({ type: String, default: "" })
  imGroupId: string;

  @Prop({ type: PipelinePreferences, default: () => ({}) })
  preferences: PipelinePreferences;

  @Prop({ type: ScheduleConfig, default: () => ({}) })
  schedule: ScheduleConfig;

  @Prop({ type: PipelineDispatchRules, default: () => ({}) })
  distributionRules: PipelineDispatchRules;

  @Prop({ type: Number, default: 0 })
  totalVideosProduced: number;

  @Prop({ type: Number, default: 0 })
  totalVideosPublished: number;
}

export const PipelineSchema = SchemaFactory.createForClass(Pipeline);
PipelineSchema.index({ orgId: 1, brandId: 1 });
