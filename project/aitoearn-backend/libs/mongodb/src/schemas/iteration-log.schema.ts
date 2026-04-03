import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema } from "mongoose";

import { DEFAULT_SCHEMA_OPTIONS } from "../mongodb.constants";
import { WithTimestampSchema } from "./timestamp.schema";

export const ITERATION_LOG_STAGES = [
  "frame_edit",
  "i2v_generate",
  "subtitle",
  "quality_check",
  "copy_generate",
] as const;

export type IterationLogStage = (typeof ITERATION_LOG_STAGES)[number];

export const ITERATION_LOG_STATUSES = [
  "success",
  "failed",
  "retried",
  "skipped",
] as const;

export type IterationLogStatus = (typeof ITERATION_LOG_STATUSES)[number];

export const ITERATION_FAIL_CATEGORIES = [
  "quality",
  "content",
  "technical",
  "brand_mismatch",
] as const;

export type IterationFailureCategory = (typeof ITERATION_FAIL_CATEGORIES)[number];

@Schema({ _id: false })
class IterationFailureAnalysis {
  @Prop({ type: String, default: "" })
  failReason: string;

  @Prop({ type: String, enum: ITERATION_FAIL_CATEGORIES, default: "quality" })
  failCategory: IterationFailureCategory;

  @Prop({ type: [String], default: [] })
  suggestedFixes: string[];

  @Prop({ type: Number, default: 0 })
  confidence: number;
}

@Schema({ _id: false })
class IterationQualityScore {
  @Prop({ type: Number, default: 0 })
  total: number;

  @Prop({ type: Number, default: 0 })
  production: number;

  @Prop({ type: Number, default: 0 })
  virality: number;

  @Prop({ type: Object, default: {} })
  dimensions: Record<string, number>;
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: "iteration_logs" })
export class IterationLog extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, type: String, index: true })
  videoTaskId: string;

  @Prop({ type: String, default: "", index: true })
  batchId?: string;

  @Prop({ required: true, type: Number })
  iteration: number;

  @Prop({
    required: true,
    type: String,
    enum: ITERATION_LOG_STAGES,
    index: true,
  })
  stage: IterationLogStage;

  @Prop({
    required: true,
    type: String,
    enum: ITERATION_LOG_STATUSES,
    index: true,
  })
  status: IterationLogStatus;

  @Prop({ type: String, default: "" })
  originalPrompt?: string;

  @Prop({ type: String, default: "" })
  optimizedPrompt?: string;

  @Prop({ type: IterationFailureAnalysis, default: null })
  failureAnalysis?: IterationFailureAnalysis | null;

  @Prop({ type: IterationQualityScore, default: null })
  qualityScore?: IterationQualityScore | null;

  @Prop({ type: Number, default: 0 })
  costCredits?: number;

  @Prop({ type: Number, default: 0 })
  durationMs?: number;

  @Prop({ type: String, default: "default" })
  strategyUsed?: string;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, unknown>;
}

export const IterationLogSchema = SchemaFactory.createForClass(IterationLog);

IterationLogSchema.index({ videoTaskId: 1, iteration: -1 });
IterationLogSchema.index({ batchId: 1, createdAt: -1 });
IterationLogSchema.index({ stage: 1, status: 1, createdAt: -1 });
