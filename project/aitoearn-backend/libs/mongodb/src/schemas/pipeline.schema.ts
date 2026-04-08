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
  CUSTOM = "custom",
}

export enum PipelineStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  ARCHIVED = "archived",
}

@Schema({ _id: false })
class PipelineBrandAssets {
  @Prop({ type: String, default: "" })
  logo: string;

  @Prop({ type: [String], default: [] })
  colors: string[];

  @Prop({ type: [String], default: [] })
  fonts: string[];
}

@Schema({ _id: false })
class PipelineStyleConfig {
  @Prop({ type: Number, default: 15 })
  duration: number;

  @Prop({ type: String, default: "9:16" })
  aspectRatio: string;

  @Prop({ type: String, default: "" })
  tone: string;

  @Prop({ type: String, default: "" })
  visualStyle: string;

  @Prop({ type: [String], default: [] })
  platforms: string[];

  @Prop({ type: PipelineBrandAssets, default: () => ({}) })
  brandAssets: PipelineBrandAssets;
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
class PipelineDistributionTarget {
  @Prop({ type: String, default: "" })
  employeeName: string;

  @Prop({ type: String, default: "" })
  assignmentId: string;

  @Prop({ type: String, default: "" })
  imChannel: string;

  @Prop({ type: String, default: "" })
  imUserId: string;

  @Prop({ type: [String], default: [] })
  targetPlatforms: string[];

  @Prop({ type: [String], default: [] })
  preferredTimeSlots: string[];

  @Prop({ type: Object, default: {} })
  outputConfig: Record<string, any>;
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

  @Prop({ type: [PipelineDistributionTarget], default: [] })
  targets: PipelineDistributionTarget[];
}

@Schema({ _id: false })
export class PipelineModelOverrides {
  @Prop({ type: String, default: "" })
  copy?: string;

  @Prop({ type: String, default: "" })
  frameEdit?: string;

  @Prop({ type: String, default: "" })
  videoGen?: string;
}

@Schema({ _id: false })
class PipelineGroupBinding {
  @Prop({ type: String, default: "" })
  channel: string;

  @Prop({ type: String, default: "" })
  groupId: string;

  @Prop({ type: String, default: "" })
  groupName: string;

  @Prop({ type: Date, default: null })
  boundAt?: Date | null;

  @Prop({ type: String, default: "" })
  boundBy: string;
}

@Schema({ _id: false })
class PipelineTrainingPreference {
  @Prop({ type: String, default: "" })
  source: string;

  @Prop({ type: String, default: "custom" })
  sourceType: string;

  @Prop({ type: String, default: "" })
  preference: string;

  @Prop({ type: Boolean, default: true })
  applied: boolean;

  @Prop({ type: Number, default: 0 })
  priority: number;

  @Prop({ type: Number, default: null })
  score?: number | null;

  @Prop({ type: String, default: "" })
  notes: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

@Schema({ _id: false })
class PipelineWarmUpState {
  @Prop({ type: Boolean, default: true })
  required: boolean;

  @Prop({ type: String, default: "idle" })
  status: string;

  @Prop({ type: Date, default: null })
  lastTriggeredAt?: Date | null;

  @Prop({ type: [String], default: [] })
  queuedTaskIds: string[];
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

  @Prop({ type: String, enum: Object.values(PipelineType), default: PipelineType.SEEDING })
  type: PipelineType;

  @Prop({
    type: String,
    enum: Object.values(PipelineStatus),
    default: PipelineStatus.ACTIVE,
    index: true,
  })
  status: PipelineStatus;

  @Prop({ type: String, default: "" })
  description: string;

  @Prop({ type: String, default: "", index: true })
  templateId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "DistributionRule", default: null, index: true })
  routingConfigId?: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: String, default: "" })
  imGroupId: string;

  @Prop({ type: PipelineGroupBinding, default: () => ({}) })
  groupBinding: PipelineGroupBinding;

  @Prop({ type: PipelineStyleConfig, default: () => ({}) })
  styleConfig: PipelineStyleConfig;

  @Prop({ type: PipelinePreferences, default: () => ({}) })
  preferences: PipelinePreferences;

  @Prop({ type: ScheduleConfig, default: () => ({}) })
  schedule: ScheduleConfig;

  @Prop({ type: PipelineDispatchRules, default: () => ({}) })
  distributionRules: PipelineDispatchRules;

  @Prop({ type: PipelineModelOverrides, default: () => ({}) })
  modelOverrides: PipelineModelOverrides;

  @Prop({ type: [PipelineTrainingPreference], default: [] })
  trainingPreferences: PipelineTrainingPreference[];

  @Prop({ type: PipelineWarmUpState, default: () => ({}) })
  warmUp: PipelineWarmUpState;

  @Prop({ type: Number, default: 0 })
  totalVideosProduced: number;

  @Prop({ type: Number, default: 0 })
  totalVideosPublished: number;
}

export const PipelineSchema = SchemaFactory.createForClass(Pipeline);
PipelineSchema.index({ orgId: 1, brandId: 1 });
PipelineSchema.index({ orgId: 1, status: 1, updatedAt: -1 });
PipelineSchema.index({ orgId: 1, templateId: 1 });
PipelineSchema.index({ "groupBinding.groupId": 1 }, { sparse: true });
