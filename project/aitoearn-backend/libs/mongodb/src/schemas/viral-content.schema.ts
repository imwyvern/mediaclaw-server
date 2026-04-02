import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema } from "mongoose";
import { DEFAULT_SCHEMA_OPTIONS } from "../mongodb.constants";
import { WithTimestampSchema } from "./timestamp.schema";

export enum ViralContentRemixStatus {
  PENDING = "pending",
  REMIXED = "remixed",
  REJECTED = "rejected",
}

@Schema({ _id: false })
class ViralContentAnalysis {
  @Prop({ type: String, default: "" })
  source: string;

  @Prop({ type: String, default: "" })
  model: string;

  @Prop({ type: String, default: "" })
  summary: string;

  @Prop({ type: [String], default: [] })
  hooks: string[];

  @Prop({ type: [String], default: [] })
  narrativeBeats: string[];

  @Prop({ type: [String], default: [] })
  visualMotifs: string[];

  @Prop({ type: [String], default: [] })
  audioCues: string[];

  @Prop({ type: String, default: "" })
  ctaStyle: string;

  @Prop({ type: [String], default: [] })
  risks: string[];

  @Prop({ type: Date, default: null })
  analyzedAt: Date | null;
}

@Schema({ _id: false })
class ViralContentBrief {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  brandId: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, default: "" })
  source: string;

  @Prop({ type: String, default: "" })
  model: string;

  @Prop({ type: String, default: "" })
  briefTitle: string;

  @Prop({ type: String, default: "" })
  coreAngle: string;

  @Prop({ type: String, default: "" })
  targetAudience: string;

  @Prop({ type: String, default: "" })
  openingHook: string;

  @Prop({ type: [String], default: [] })
  scenePlan: string[];

  @Prop({ type: [String], default: [] })
  copyIdeas: string[];

  @Prop({ type: [String], default: [] })
  brandSafetyNotes: string[];

  @Prop({ type: [String], default: [] })
  productionNotes: string[];

  @Prop({ type: Date, default: null })
  generatedAt: Date | null;
}

@Schema({ _id: false })
class ViralContentRemixHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  brandId: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  taskId: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: Date, default: Date.now })
  remixedAt: Date;
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: "viral_contents" })
export class ViralContent extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, type: String, index: true })
  platform: string;

  @Prop({ required: true, type: String })
  videoId: string;

  @Prop({ type: String, default: "" })
  title: string;

  @Prop({ type: String, default: "" })
  author: string;

  @Prop({ type: Number, default: 0, index: true })
  viralScore: number;

  @Prop({ type: Number, default: 0 })
  views: number;

  @Prop({ type: Number, default: 0 })
  likes: number;

  @Prop({ type: Number, default: 0 })
  comments: number;

  @Prop({ type: Number, default: 0 })
  shares: number;

  @Prop({ type: String, default: "", index: true })
  industry: string;

  @Prop({ type: [String], default: [] })
  keywords: string[];

  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ type: Date, default: Date.now, index: true })
  discoveredAt: Date;

  @Prop({ type: String, default: "" })
  contentUrl: string;

  @Prop({ type: String, default: "" })
  thumbnailUrl: string;

  @Prop({
    type: String,
    enum: ViralContentRemixStatus,
    default: ViralContentRemixStatus.PENDING,
    index: true,
  })
  remixStatus: ViralContentRemixStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  remixTaskId: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: ViralContentAnalysis, default: null })
  analysisResult: ViralContentAnalysis | null;

  @Prop({ type: [ViralContentBrief], default: [] })
  remixBriefs: ViralContentBrief[];

  @Prop({ type: [ViralContentRemixHistory], default: [] })
  remixHistory: ViralContentRemixHistory[];
}

export const ViralContentSchema = SchemaFactory.createForClass(ViralContent);
ViralContentSchema.index({ platform: 1, videoId: 1 }, { unique: true });
ViralContentSchema.index({ industry: 1, viralScore: -1, discoveredAt: -1 });
ViralContentSchema.index({
  platform: 1,
  industry: 1,
  remixStatus: 1,
  createdAt: -1,
});
