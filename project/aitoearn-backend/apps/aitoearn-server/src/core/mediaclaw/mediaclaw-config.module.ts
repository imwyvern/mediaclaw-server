import { Module } from "@nestjs/common";
import { MediaclawConfigService } from "./mediaclaw-config.service";

@Module({
  providers: [MediaclawConfigService],
  exports: [MediaclawConfigService],
})
export class MediaclawConfigModule {}
