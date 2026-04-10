import type { OnApplicationBootstrap } from '@nestjs/common'
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import {
  OssLifecycleClientFactory,
  OssLifecycleConnectionConfig,
  OssLifecycleRule,
} from './oss-lifecycle-client.factory'

type StorageLifecycleTargetKind = 'backup' | 'video'

interface StorageLifecycleTargetPlan {
  kind: StorageLifecycleTargetKind
  bucket: string
  label: string
  rules: OssLifecycleRule[]
  connection: OssLifecycleConnectionConfig | null
  message?: string
}

interface StorageLifecycleBucketPlan {
  bucket: string
  connection: OssLifecycleConnectionConfig
  rules: OssLifecycleRule[]
}

export interface StorageLifecycleTargetStatus {
  kind: StorageLifecycleTargetKind
  bucket: string
  label: string
  compliant: boolean
  configured: boolean
  lastSyncedAt: string | null
  lastVerifiedAt: string | null
  message: string | null
  expectedRules: OssLifecycleRule[]
  remoteRules: OssLifecycleRule[]
}

export interface StorageLifecycleStatus {
  enabled: boolean
  compliant: boolean
  checkedAt: string | null
  targets: StorageLifecycleTargetStatus[]
}

interface ParsedBucketUrl {
  bucket: string
  prefix: string
}

interface ParsedAssetsConfig {
  provider?: string
  accessKeyId?: string
  accessKeySecret?: string
  bucket?: string
  region?: string
  endpoint?: string
  secure?: boolean
  internal?: boolean
  timeout?: string | number
  cname?: boolean
}

@Injectable()
export class StorageLifecycleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageLifecycleService.name)
  private status: StorageLifecycleStatus = {
    enabled: false,
    compliant: true,
    checkedAt: null,
    targets: [],
  }

  constructor(
    private readonly configService: MediaclawConfigService,
    private readonly lifecycleClientFactory: OssLifecycleClientFactory,
  ) {}

  async onApplicationBootstrap() {
    await this.syncPolicies('bootstrap')
  }

  @Cron('0 */6 * * *')
  async syncPolicies(trigger: 'bootstrap' | 'schedule' | 'manual' = 'schedule') {
    const checkedAt = new Date().toISOString()
    const plans = this.buildTargetPlans()
    if (plans.length === 0) {
      this.status = {
        enabled: false,
        compliant: true,
        checkedAt,
        targets: [],
      }
      return this.status
    }

    const bucketPlans = this.groupBucketPlans(plans)
    const remoteRulesByBucket = new Map<string, OssLifecycleRule[]>()
    const syncErrors = new Map<string, string>()

    for (const bucketPlan of bucketPlans) {
      try {
        const client = this.lifecycleClientFactory.create(bucketPlan.connection)
        await client.putBucketLifecycle(bucketPlan.bucket, bucketPlan.rules)
        const remote = await client.getBucketLifecycle(bucketPlan.bucket)
        remoteRulesByBucket.set(bucketPlan.bucket, this.normalizeRules(remote.rules || []))
      }
      catch (error) {
        syncErrors.set(bucketPlan.bucket, error instanceof Error ? error.message : String(error))
      }
    }

    const targetStatuses = plans.map((plan) => {
      if (!plan.connection) {
        return {
          kind: plan.kind,
          bucket: plan.bucket,
          label: plan.label,
          compliant: false,
          configured: false,
          lastSyncedAt: null,
          lastVerifiedAt: checkedAt,
          message: plan.message || 'missing oss connection config',
          expectedRules: plan.rules,
          remoteRules: [],
        } satisfies StorageLifecycleTargetStatus
      }

      const syncError = syncErrors.get(plan.bucket)
      if (syncError) {
        return {
          kind: plan.kind,
          bucket: plan.bucket,
          label: plan.label,
          compliant: false,
          configured: true,
          lastSyncedAt: null,
          lastVerifiedAt: checkedAt,
          message: syncError,
          expectedRules: plan.rules,
          remoteRules: [],
        } satisfies StorageLifecycleTargetStatus
      }

      const remoteRules = remoteRulesByBucket.get(plan.bucket) || []
      const compliant = plan.rules.every(rule => this.hasMatchingRule(remoteRules, rule))
      return {
        kind: plan.kind,
        bucket: plan.bucket,
        label: plan.label,
        compliant,
        configured: true,
        lastSyncedAt: checkedAt,
        lastVerifiedAt: checkedAt,
        message: compliant ? null : 'oss lifecycle rule drift detected',
        expectedRules: plan.rules,
        remoteRules,
      } satisfies StorageLifecycleTargetStatus
    })

    this.status = {
      enabled: true,
      compliant: targetStatuses.every(target => target.compliant),
      checkedAt,
      targets: targetStatuses,
    }

    if (!this.status.compliant) {
      this.logger.warn({
        message: 'OSS lifecycle policy drift detected',
        trigger,
        targets: targetStatuses.map(target => ({
          kind: target.kind,
          bucket: target.bucket,
          compliant: target.compliant,
          configured: target.configured,
        })),
      })
    }
    else {
      this.logger.log(`OSS lifecycle policies synced (${trigger})`)
    }

    return this.status
  }

  getStatus(): StorageLifecycleStatus {
    return {
      enabled: this.status.enabled,
      compliant: this.status.compliant,
      checkedAt: this.status.checkedAt,
      targets: this.status.targets.map(target => ({
        ...target,
        expectedRules: target.expectedRules.map(rule => ({ ...rule })),
        remoteRules: target.remoteRules.map(rule => ({ ...rule })),
      })),
    }
  }

  private buildTargetPlans(): StorageLifecycleTargetPlan[] {
    const plans: StorageLifecycleTargetPlan[] = []
    const backupPlan = this.buildBackupPlan()
    if (backupPlan) {
      plans.push(backupPlan)
    }

    const videoPlan = this.buildVideoPlan()
    if (videoPlan) {
      plans.push(videoPlan)
    }

    return plans
  }

  private buildBackupPlan(): StorageLifecycleTargetPlan | null {
    const rawBucketUrl = this.configService.getString(['BACKUP_BUCKET_URL', 'MEDIACLAW_BACKUP_BUCKET_URL'], '')
    if (!rawBucketUrl.startsWith('oss://')) {
      return null
    }

    const parsed = this.parseBucketUrl(rawBucketUrl)
    if (!parsed) {
      return {
        kind: 'backup',
        bucket: 'unknown',
        label: 'MongoDB daily backup retention',
        connection: null,
        message: `invalid oss backup bucket url: ${rawBucketUrl}`,
        rules: [],
      }
    }

    const connection = this.resolveOssConnection(parsed.bucket)
    const backupPrefix = this.joinPrefix(parsed.prefix, 'daily')
    const retentionDays = this.configService.getNumber(
      ['MEDIACLAW_BACKUP_RETENTION_DAYS', 'BACKUP_RETENTION_DAILY'],
      30,
    )
    return {
      kind: 'backup',
      bucket: parsed.bucket,
      label: 'MongoDB daily backup retention',
      connection,
      message: connection ? undefined : 'missing OSS credentials for backup lifecycle sync',
      rules: [
        {
          id: 'mediaclaw-backup-daily-retention',
          prefix: backupPrefix,
          status: 'Enabled',
          expiration: {
            days: String(Math.max(retentionDays, 1)),
          },
          abortMultipartUpload: {
            days: '7',
          },
        },
      ],
    }
  }

  private buildVideoPlan(): StorageLifecycleTargetPlan | null {
    const connection = this.resolveVideoOssConnection()
    if (!connection) {
      return null
    }

    const transitionDays = this.configService.getNumber('MEDIACLAW_OSS_VIDEO_TRANSITION_DAYS', 365)
    const prefix = this.normalizePrefix(this.configService.getString('MEDIACLAW_OSS_VIDEO_PREFIX', 'videos/'))
    return {
      kind: 'video',
      bucket: connection.bucket,
      label: 'Video object low-frequency transition',
      connection,
      rules: [
        {
          id: 'mediaclaw-video-transition-ia',
          prefix,
          status: 'Enabled',
          transition: {
            days: String(Math.max(transitionDays, 1)),
            storageClass: 'IA',
          },
          abortMultipartUpload: {
            days: '7',
          },
        },
      ],
    }
  }

  private groupBucketPlans(plans: StorageLifecycleTargetPlan[]): StorageLifecycleBucketPlan[] {
    const buckets = new Map<string, StorageLifecycleBucketPlan>()
    for (const plan of plans) {
      if (!plan.connection) {
        continue
      }

      const key = this.buildBucketKey(plan.connection)
      const existing = buckets.get(key)
      if (existing) {
        existing.rules = this.mergeRules(existing.rules, plan.rules)
        continue
      }

      buckets.set(key, {
        bucket: plan.bucket,
        connection: plan.connection,
        rules: this.mergeRules([], plan.rules),
      })
    }

    return [...buckets.values()]
  }

  private buildBucketKey(connection: OssLifecycleConnectionConfig) {
    return JSON.stringify({
      bucket: connection.bucket,
      region: connection.region,
      endpoint: connection.endpoint || '',
      accessKeyId: connection.accessKeyId,
    })
  }

  private mergeRules(current: OssLifecycleRule[], next: OssLifecycleRule[]) {
    const map = new Map<string, OssLifecycleRule>()
    for (const rule of [...current, ...next]) {
      map.set(rule.id, rule)
    }
    return [...map.values()]
  }

  private hasMatchingRule(remoteRules: OssLifecycleRule[], expectedRule: OssLifecycleRule) {
    return remoteRules.some((remoteRule) => {
      if (remoteRule.id !== expectedRule.id) {
        return false
      }

      return this.normalizePrefix(remoteRule.prefix) === this.normalizePrefix(expectedRule.prefix)
        && remoteRule.status === expectedRule.status
        && String(remoteRule.expiration?.days || '') === String(expectedRule.expiration?.days || '')
        && String(remoteRule.abortMultipartUpload?.days || '') === String(expectedRule.abortMultipartUpload?.days || '')
        && String(remoteRule.transition?.days || '') === String(expectedRule.transition?.days || '')
        && (remoteRule.transition?.storageClass || '') === (expectedRule.transition?.storageClass || '')
    })
  }

  private normalizeRules(rules: OssLifecycleRule[]) {
    return rules.map(rule => ({
      id: rule.id,
      prefix: this.normalizePrefix(rule.prefix),
      status: rule.status,
      expiration: rule.expiration?.days
        ? { days: String(rule.expiration.days) }
        : undefined,
      abortMultipartUpload: rule.abortMultipartUpload?.days
        ? { days: String(rule.abortMultipartUpload.days) }
        : undefined,
      transition: rule.transition?.days && rule.transition.storageClass
        ? {
            days: String(rule.transition.days),
            storageClass: rule.transition.storageClass,
          }
        : undefined,
    }))
  }

  private resolveVideoOssConnection() {
    const parsedAssetsConfig = this.parseAssetsConfig()
    if (parsedAssetsConfig?.provider === 'ali-oss' && parsedAssetsConfig.bucket) {
      const connection = this.resolveOssConnection(parsedAssetsConfig.bucket)
      if (connection) {
        return {
          ...connection,
          endpoint: connection.endpoint || parsedAssetsConfig.endpoint,
          secure: connection.secure ?? parsedAssetsConfig.secure,
          internal: connection.internal ?? parsedAssetsConfig.internal,
          timeout: connection.timeout ?? parsedAssetsConfig.timeout,
          cname: connection.cname ?? parsedAssetsConfig.cname,
        }
      }
    }

    const explicitBucket = this.configService.getString(
      ['MEDIACLAW_OSS_BUCKET', 'ALI_OSS_BUCKET'],
      '',
    )
    return explicitBucket ? this.resolveOssConnection(explicitBucket) : null
  }

  private resolveOssConnection(bucket: string): OssLifecycleConnectionConfig | null {
    const parsedAssetsConfig = this.parseAssetsConfig()
    const accessKeyId = this.configService.getString(
      ['MEDIACLAW_OSS_ACCESS_KEY_ID', 'ALI_OSS_ACCESS_KEY_ID'],
      parsedAssetsConfig?.provider === 'ali-oss' ? parsedAssetsConfig.accessKeyId || '' : '',
    )
    const accessKeySecret = this.configService.getString(
      ['MEDIACLAW_OSS_ACCESS_KEY_SECRET', 'ALI_OSS_ACCESS_KEY_SECRET'],
      parsedAssetsConfig?.provider === 'ali-oss' ? parsedAssetsConfig.accessKeySecret || '' : '',
    )
    const region = this.configService.getString(
      ['MEDIACLAW_OSS_REGION', 'ALI_OSS_REGION'],
      parsedAssetsConfig?.provider === 'ali-oss' ? parsedAssetsConfig.region || '' : '',
    )

    if (!bucket || !accessKeyId || !accessKeySecret || !region) {
      return null
    }

    return {
      accessKeyId,
      accessKeySecret,
      bucket,
      region,
      endpoint: this.configService.getString(
        ['MEDIACLAW_OSS_ENDPOINT', 'ALI_OSS_ENDPOINT'],
        parsedAssetsConfig?.provider === 'ali-oss' ? parsedAssetsConfig.endpoint || '' : '',
      ) || undefined,
      secure: this.resolveBoolean(
        ['MEDIACLAW_OSS_SECURE', 'ALI_OSS_SECURE'],
        parsedAssetsConfig?.provider === 'ali-oss' ? parsedAssetsConfig.secure : undefined,
      ),
      internal: this.resolveBoolean(
        ['MEDIACLAW_OSS_INTERNAL', 'ALI_OSS_INTERNAL'],
        parsedAssetsConfig?.provider === 'ali-oss' ? parsedAssetsConfig.internal : undefined,
      ),
      cname: this.resolveBoolean(
        ['MEDIACLAW_OSS_CNAME', 'ALI_OSS_CNAME'],
        parsedAssetsConfig?.provider === 'ali-oss' ? parsedAssetsConfig.cname : undefined,
      ),
      timeout: this.resolveTimeout(parsedAssetsConfig?.provider === 'ali-oss' ? parsedAssetsConfig.timeout : undefined),
    }
  }

  private resolveTimeout(fallback?: string | number) {
    const raw = this.configService.getString(['MEDIACLAW_OSS_TIMEOUT', 'ALI_OSS_TIMEOUT'], '')
    if (raw) {
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? parsed : raw
    }

    return fallback
  }

  private resolveBoolean(keys: string[], fallback?: boolean) {
    const raw = this.configService.getString(keys, '')
    if (!raw) {
      return fallback
    }

    const normalized = raw.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false
    }
    return fallback
  }

  private parseAssetsConfig(): ParsedAssetsConfig | null {
    const raw = this.configService.getString('ASSETS_CONFIG', '')
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as ParsedAssetsConfig
      return parsed && typeof parsed === 'object' ? parsed : null
    }
    catch {
      return null
    }
  }

  private parseBucketUrl(rawUrl: string): ParsedBucketUrl | null {
    const normalized = rawUrl.trim()
    if (!normalized.toLowerCase().startsWith('oss://')) {
      return null
    }

    try {
      const parsed = new URL(normalized)
      return {
        bucket: parsed.hostname,
        prefix: this.normalizePrefix(parsed.pathname.replace(/^\/+/, '')),
      }
    }
    catch {
      return null
    }
  }

  private joinPrefix(...parts: string[]) {
    const normalized = parts
      .map(part => part.trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/')
    return normalized ? `${normalized}/` : ''
  }

  private normalizePrefix(prefix: string) {
    const normalized = prefix.trim().replace(/^\/+/, '')
    if (!normalized) {
      return ''
    }

    return normalized.endsWith('/') ? normalized : `${normalized}/`
  }
}
