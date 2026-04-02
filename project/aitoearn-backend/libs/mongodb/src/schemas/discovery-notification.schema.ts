import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema } from "mongoose";
import { DEFAULT_SCHEMA_OPTIONS } from "../mongodb.constants";
import { WithTimestampSchema } from "./timestamp.schema";

export enum DiscoveryNotificationStatus {
  PENDING = "pending",
  SENT = "sent",
  READ = "read",
}

@Schema({ _id: false })
class DiscoveryNotificationTopItem {
  @Prop({ type: String, default: "" })
  videoId: string;

  @Prop({ type: String, default: "" })
  title: string;

  @Prop({ type: Number, default: 0 })
  viralScore: number;

  @Prop({ type: String, default: "" })
  contentUrl: string;
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: "discovery_notifications" })
export class DiscoveryNotification extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  orgId: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, default: "", index: true })
  industry: string;

  @Prop({ type: String, default: "", index: true })
  platform: string;

  @Prop({ type: String, default: "" })
  title: string;

  @Prop({ type: String, default: "" })
  summary: string;

  @Prop({ type: Number, default: 0 })
  itemCount: number;

  @Prop({ type: [DiscoveryNotificationTopItem], default: [] })
  topItems: DiscoveryNotificationTopItem[];

  @Prop({ type: Date, default: Date.now, index: true })
  notifiedAt: Date;

  @Prop({
    type: String,
    enum: DiscoveryNotificationStatus,
    default: DiscoveryNotificationStatus.PENDING,
    index: true,
  })
  status: DiscoveryNotificationStatus;
}

export const DiscoveryNotificationSchema = SchemaFactory.createForClass(
  DiscoveryNotification,
);
DiscoveryNotificationSchema.index({ orgId: 1, notifiedAt: -1 });
DiscoveryNotificationSchema.index({ orgId: 1, status: 1, notifiedAt: -1 });
