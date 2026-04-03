import { Injectable } from "@nestjs/common";

type ConfigKeyInput = string | readonly string[];

@Injectable()
export class MediaclawConfigService {
  getString(keys: ConfigKeyInput, fallback = "") {
    for (const key of this.normalizeKeys(keys)) {
      const value = process.env[key]?.trim();
      if (value) {
        return value;
      }
    }

    return fallback;
  }

  getNumber(keys: ConfigKeyInput, fallback: number) {
    const value = this.getString(keys, "");
    if (!value) {
      return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  has(keys: ConfigKeyInput) {
    return Boolean(this.getString(keys, ""));
  }

  private normalizeKeys(keys: ConfigKeyInput) {
    return Array.isArray(keys) ? [...keys] : [keys];
  }
}
