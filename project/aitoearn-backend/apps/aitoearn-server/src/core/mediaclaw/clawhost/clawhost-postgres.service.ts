import type { OnModuleDestroy } from '@nestjs/common'
import type { PoolClient, PoolConfig } from 'pg'
import { Injectable, Logger } from '@nestjs/common'
import { Pool } from 'pg'
import { MediaclawConfigService } from '../mediaclaw-config.service'

interface ClawHostHealthSnapshot {
  lastCheck?: Date | null
  isHealthy?: boolean
  latency?: number
}

interface ClawHostInstalledSkillSnapshot {
  skillId: string
  version: string
  installedAt?: Date | null
}

export interface ClawHostPostgresSyncInput {
  instanceId: string
  orgId: string
  clientName: string
  plan?: string
  status: string
  deploymentMode?: string
  runtimeKind?: string
  config?: {
    cpu?: string
    memory?: string
    storage?: string
  }
  skills?: ClawHostInstalledSkillSnapshot[]
  healthStatus?: ClawHostHealthSnapshot
  requestedImChannel?: string
  accessUrl?: string
  healthUrl?: string
  k8sNamespace?: string
  k8sPodName?: string
  hostPort?: number
  runtimeImage?: string
  containerId?: string
  containerName?: string
  lastHealthMessage?: string
  boundApiKeyPrefix?: string
  boundAt?: Date | null
  lastHeartbeatAt?: Date | null
  lastClientVersion?: string
  heartbeatCapabilities?: string[]
  connectionCodePreview?: string
}

export interface ClawHostPostgresSyncOptions {
  appName?: string
  ownerUserId?: string
  apiToken?: string
  deviceId?: string
  deviceApproved?: boolean
}

@Injectable()
export class ClawHostPostgresService implements OnModuleDestroy {
  private readonly logger = new Logger(ClawHostPostgresService.name)
  private pool: Pool | null = null
  private schemaReady = false
  private schemaReadyPromise: Promise<void> | null = null
  private disabledLogged = false

  constructor(private readonly configService: MediaclawConfigService) {}

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end().catch(() => undefined)
      this.pool = null
    }
  }

  async syncInstance(
    input: ClawHostPostgresSyncInput,
    options: ClawHostPostgresSyncOptions = {},
  ) {
    const pool = this.getPool()
    if (!pool) {
      this.logDisabledOnce()
      return {
        enabled: false,
        synced: false,
      }
    }

    await this.ensureSchemaReady()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await this.upsertApp(client, input, options)
      await this.upsertBot(client, input, options)
      await this.syncChannels(client, input)
      await this.syncDevice(client, input, options)
      await client.query('COMMIT')

      return {
        enabled: true,
        synced: true,
      }
    }
    catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
    finally {
      client.release()
    }
  }

  private getPool() {
    if (this.pool) {
      return this.pool
    }

    const config = this.buildPoolConfig()
    if (!config) {
      return null
    }

    this.pool = new Pool(config)
    return this.pool
  }

  private buildPoolConfig(): PoolConfig | null {
    const connectionString = this.configService.getString(
      ['CLAWHOST_POSTGRES_URL', 'CLAWHOST_POSTGRES_URI'],
      '',
    )
    if (connectionString) {
      return {
        connectionString,
        max: this.configService.getNumber('CLAWHOST_POSTGRES_MAX', 5),
      }
    }

    const host = this.configService.getString('CLAWHOST_POSTGRES_HOST', '')
    const database = this.configService.getString(
      ['CLAWHOST_POSTGRES_DB', 'CLAWHOST_POSTGRES_DATABASE'],
      '',
    )
    const user = this.configService.getString('CLAWHOST_POSTGRES_USER', '')
    if (!host || !database || !user) {
      return null
    }

    const password = this.configService.getString('CLAWHOST_POSTGRES_PASSWORD', '')
    const ssl = this.configService.getString('CLAWHOST_POSTGRES_SSL', '').toLowerCase() === 'true'

    return {
      host,
      database,
      user,
      password: password || undefined,
      port: this.configService.getNumber('CLAWHOST_POSTGRES_PORT', 5432),
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      max: this.configService.getNumber('CLAWHOST_POSTGRES_MAX', 5),
    }
  }

  private async ensureSchemaReady() {
    if (this.schemaReady) {
      return
    }

    if (this.schemaReadyPromise) {
      await this.schemaReadyPromise
      return
    }

    const pool = this.getPool()
    if (!pool) {
      return
    }

    this.schemaReadyPromise = (async () => {
      const client = await pool.connect()
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS apps (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            api_token TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `)
        await client.query(`
          CREATE TABLE IF NOT EXISTS bots (
            id TEXT PRIMARY KEY,
            app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
            user_id TEXT,
            name TEXT NOT NULL,
            slug TEXT NOT NULL,
            status TEXT NOT NULL,
            config JSONB NOT NULL DEFAULT '{}'::jsonb,
            openclaw_config JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `)
        await client.query(`
          CREATE TABLE IF NOT EXISTS bot_channels (
            bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
            channel_type TEXT NOT NULL,
            config JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (bot_id, channel_type)
          )
        `)
        await client.query(`
          CREATE TABLE IF NOT EXISTS bot_devices (
            bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
            device_id TEXT NOT NULL,
            approved BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (bot_id, device_id)
          )
        `)
        await client.query('CREATE INDEX IF NOT EXISTS idx_bots_app_id ON bots(app_id)')
        await client.query('CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status)')
        await client.query('CREATE INDEX IF NOT EXISTS idx_bot_channels_type ON bot_channels(channel_type)')
        await client.query('CREATE INDEX IF NOT EXISTS idx_bot_devices_approved ON bot_devices(approved)')
        this.schemaReady = true
      }
      finally {
        client.release()
      }
    })()

    try {
      await this.schemaReadyPromise
    }
    finally {
      this.schemaReadyPromise = null
    }
  }

  private async upsertApp(
    client: PoolClient,
    input: ClawHostPostgresSyncInput,
    options: ClawHostPostgresSyncOptions,
  ) {
    const appId = input.orgId.trim()
    const appName = options.appName?.trim() || input.orgId.trim()
    const apiToken = options.apiToken?.trim() || ''

    await client.query(
      `
        INSERT INTO apps (id, name, api_token, created_at, updated_at)
        VALUES ($1, $2, NULLIF($3, ''), NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          api_token = COALESCE(EXCLUDED.api_token, apps.api_token),
          updated_at = NOW()
      `,
      [appId, appName, apiToken],
    )
  }

  private async upsertBot(
    client: PoolClient,
    input: ClawHostPostgresSyncInput,
    options: ClawHostPostgresSyncOptions,
  ) {
    const botId = input.instanceId.trim()
    const appId = input.orgId.trim()
    const ownerUserId = options.ownerUserId?.trim() || ''

    await client.query(
      `
        INSERT INTO bots (
          id,
          app_id,
          user_id,
          name,
          slug,
          status,
          config,
          openclaw_config,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          NULLIF($3, ''),
          $4,
          $5,
          $6,
          $7::jsonb,
          $8::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          app_id = EXCLUDED.app_id,
          user_id = COALESCE(EXCLUDED.user_id, bots.user_id),
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          status = EXCLUDED.status,
          config = EXCLUDED.config,
          openclaw_config = EXCLUDED.openclaw_config,
          updated_at = NOW()
      `,
      [
        botId,
        appId,
        ownerUserId,
        input.clientName.trim(),
        this.slugify(input.clientName) || botId,
        input.status.trim(),
        JSON.stringify(this.buildBotConfig(input)),
        JSON.stringify(this.buildOpenClawConfig(input)),
      ],
    )
  }

  private async syncChannels(client: PoolClient, input: ClawHostPostgresSyncInput) {
    const botId = input.instanceId.trim()
    const channelType = input.requestedImChannel?.trim() || ''

    if (!channelType) {
      await client.query('DELETE FROM bot_channels WHERE bot_id = $1', [botId])
      return
    }

    await client.query(
      'DELETE FROM bot_channels WHERE bot_id = $1 AND channel_type <> $2',
      [botId, channelType],
    )
    await client.query(
      `
        INSERT INTO bot_channels (bot_id, channel_type, config, created_at, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW(), NOW())
        ON CONFLICT (bot_id, channel_type) DO UPDATE SET
          config = EXCLUDED.config,
          updated_at = NOW()
      `,
      [
        botId,
        channelType,
        JSON.stringify({
          boundApiKeyPrefix: input.boundApiKeyPrefix?.trim() || '',
          boundAt: input.boundAt?.toISOString?.() || null,
          lastHeartbeatAt: input.lastHeartbeatAt?.toISOString?.() || null,
          capabilities: input.heartbeatCapabilities || [],
        }),
      ],
    )
  }

  private async syncDevice(
    client: PoolClient,
    input: ClawHostPostgresSyncInput,
    options: ClawHostPostgresSyncOptions,
  ) {
    const deviceId = options.deviceId?.trim() || ''
    if (!deviceId) {
      return
    }

    await client.query(
      `
        INSERT INTO bot_devices (bot_id, device_id, approved, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (bot_id, device_id) DO UPDATE SET
          approved = EXCLUDED.approved,
          updated_at = NOW()
      `,
      [input.instanceId.trim(), deviceId, options.deviceApproved ?? true],
    )
  }

  private buildBotConfig(input: ClawHostPostgresSyncInput) {
    return {
      plan: input.plan?.trim() || 'starter',
      deploymentMode: input.deploymentMode?.trim() || 'byoc',
      runtimeKind: input.runtimeKind?.trim() || 'docker',
      resources: {
        cpu: input.config?.cpu?.trim() || '',
        memory: input.config?.memory?.trim() || '',
        storage: input.config?.storage?.trim() || '',
      },
      health: {
        isHealthy: input.healthStatus?.isHealthy ?? false,
        latency: input.healthStatus?.latency ?? 0,
        lastCheck: input.healthStatus?.lastCheck?.toISOString?.() || null,
        lastMessage: input.lastHealthMessage?.trim() || '',
      },
    }
  }

  private buildOpenClawConfig(input: ClawHostPostgresSyncInput) {
    return {
      accessUrl: input.accessUrl?.trim() || '',
      healthUrl: input.healthUrl?.trim() || '',
      hostPort: Number.isFinite(input.hostPort) ? Number(input.hostPort) : 0,
      runtimeImage: input.runtimeImage?.trim() || '',
      runtimeKind: input.runtimeKind?.trim() || 'docker',
      k8sNamespace: input.k8sNamespace?.trim() || '',
      k8sPodName: input.k8sPodName?.trim() || '',
      containerId: input.containerId?.trim() || '',
      containerName: input.containerName?.trim() || '',
      lastClientVersion: input.lastClientVersion?.trim() || '',
      connectionCodePreview: input.connectionCodePreview?.trim() || '',
      skills: (input.skills || []).map(skill => ({
        skillId: skill.skillId,
        version: skill.version,
        installedAt: skill.installedAt?.toISOString?.() || null,
      })),
    }
  }

  private slugify(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  private logDisabledOnce() {
    if (this.disabledLogged) {
      return
    }

    this.disabledLogged = true
    this.logger.log('ClawHost PostgreSQL sync is disabled: no PostgreSQL config found')
  }
}
