import type { OnModuleDestroy } from '@nestjs/common'
import type { PoolClient, PoolConfig } from 'pg'
import { Injectable, Logger } from '@nestjs/common'
import { Pool } from 'pg'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import { CLAWHOST_POSTGRES_MIGRATIONS } from './migrations'

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
  instanceLayer?: Record<string, unknown>
  gatewayConfig?: Record<string, unknown>
  sharedExperienceConfig?: Record<string, unknown>
  installCommand?: string
  lastHealthMessage?: string
  connectionCodeHash?: string
  connectionCodeIssuedAt?: Date | null
  connectionCodeExpiresAt?: Date | null
  boundApiKeyId?: string
  boundApiKeyPrefix?: string
  boundAt?: Date | null
  lastHeartbeatAt?: Date | null
  lastClientVersion?: string
  lastAgentId?: string
  heartbeatCapabilities?: string[]
  connectionCodePreview?: string
  cacheSyncedAt?: Date | null
  createdAt?: Date | null
  updatedAt?: Date | null
}

export interface ClawHostPostgresSyncOptions {
  appName?: string
  ownerUserId?: string
  apiToken?: string
  deviceId?: string
  deviceApproved?: boolean
}

export interface ClawHostPostgresInstanceRecord extends ClawHostPostgresSyncInput {
  createdAt: Date | null
  updatedAt: Date | null
}

interface ClawHostPostgresListFilters {
  orgId?: string
  status?: string
  statuses?: string[]
  offset?: number
  limit?: number
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
    const record = await this.upsertInstance(input, options)
    return {
      enabled: Boolean(record),
      synced: Boolean(record),
    }
  }

  async upsertInstance(
    input: ClawHostPostgresSyncInput,
    options: ClawHostPostgresSyncOptions = {},
  ) {
    const pool = this.getPool()
    if (!pool) {
      this.logDisabledOnce()
      return null
    }

    await this.ensureSchemaReady()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      const record = await this.upsertControlPlaneInstance(client, input)
      await this.upsertApp(client, input, options)
      await this.upsertBot(client, input, options)
      await this.syncChannels(client, input)
      await this.syncDevice(client, input, options)
      await client.query('COMMIT')

      return record
    }
    catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
    finally {
      client.release()
    }
  }

  isEnabled() {
    return Boolean(this.getPool())
  }

  async getInstance(orgId: string, instanceId: string) {
    const pool = this.getPool()
    if (!pool) {
      this.logDisabledOnce()
      return null
    }

    await this.ensureSchemaReady()
    const result = await pool.query(
      `
        SELECT *
        FROM clawhost_instances
        WHERE instance_id = $1
          AND org_id = $2
        LIMIT 1
      `,
      [instanceId.trim(), orgId.trim()],
    )

    return this.mapRecord(result.rows[0])
  }

  async findByBoundApiKeyId(boundApiKeyId: string) {
    const normalized = boundApiKeyId?.trim()
    if (!normalized) {
      return null
    }

    const pool = this.getPool()
    if (!pool) {
      this.logDisabledOnce()
      return null
    }

    await this.ensureSchemaReady()
    const result = await pool.query(
      `
        SELECT *
        FROM clawhost_instances
        WHERE bound_api_key_id = $1
        LIMIT 1
      `,
      [normalized],
    )

    return this.mapRecord(result.rows[0])
  }

  async findByAgent(orgId: string, agentId: string) {
    const normalizedOrgId = orgId?.trim()
    const normalizedAgentId = agentId?.trim()
    if (!normalizedOrgId || !normalizedAgentId) {
      return null
    }

    const pool = this.getPool()
    if (!pool) {
      this.logDisabledOnce()
      return null
    }

    await this.ensureSchemaReady()
    const result = await pool.query(
      `
        SELECT *
        FROM clawhost_instances
        WHERE org_id = $1
          AND (instance_id = $2 OR last_agent_id = $2)
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [normalizedOrgId, normalizedAgentId],
    )

    return this.mapRecord(result.rows[0])
  }

  async listInstances(filters: ClawHostPostgresListFilters = {}) {
    const pool = this.getPool()
    if (!pool) {
      this.logDisabledOnce()
      return {
        items: [] as ClawHostPostgresInstanceRecord[],
        total: 0,
      }
    }

    await this.ensureSchemaReady()

    const conditions = [] as string[]
    const values = [] as Array<string | number | string[]>
    const statusValues = Array.isArray(filters.statuses) && filters.statuses.length > 0
      ? filters.statuses
      : filters.status
        ? [filters.status]
        : []

    if (filters.orgId?.trim()) {
      values.push(filters.orgId.trim())
      conditions.push(`org_id = $${values.length}`)
    }

    if (statusValues.length > 0) {
      values.push(statusValues)
      conditions.push(`status = ANY($${values.length})`)
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : ''
    const limit = Math.max(1, Math.min(Number(filters.limit || 20), 100))
    const offset = Math.max(0, Number(filters.offset || 0))

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM clawhost_instances
        ${whereClause}
      `,
      values,
    )

    values.push(limit)
    values.push(offset)
    const itemsResult = await pool.query(
      `
        SELECT *
        FROM clawhost_instances
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `,
      values,
    )

    return {
      items: itemsResult.rows
        .map(row => this.mapRecord(row))
        .filter((item): item is ClawHostPostgresInstanceRecord => Boolean(item)),
      total: Number(countResult.rows[0]?.total || 0),
    }
  }

  async listManagedDockerHostPorts() {
    const pool = this.getPool()
    if (!pool) {
      this.logDisabledOnce()
      return [] as number[]
    }

    await this.ensureSchemaReady()
    const result = await pool.query(
      `
        SELECT host_port
        FROM clawhost_instances
        WHERE deployment_mode = 'managed'
          AND runtime_kind = 'docker'
          AND host_port > 0
      `,
    )

    return result.rows
      .map(row => Number(row.host_port || 0))
      .filter(port => Number.isFinite(port) && port > 0)
  }

  async markCacheSynced(instanceId: string, syncedAt = new Date()) {
    const pool = this.getPool()
    if (!pool) {
      return
    }

    await this.ensureSchemaReady()
    await pool.query(
      `
        UPDATE clawhost_instances
        SET cache_synced_at = $2,
            updated_at = NOW()
        WHERE instance_id = $1
      `,
      [instanceId.trim(), syncedAt],
    )
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
          CREATE TABLE IF NOT EXISTS clawhost_schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `)
        for (const migration of CLAWHOST_POSTGRES_MIGRATIONS) {
          const migrationResult = await client.query(
            'SELECT 1 FROM clawhost_schema_migrations WHERE id = $1 LIMIT 1',
            [migration.id],
          )
          if (migrationResult.rowCount) {
            continue
          }

          for (const statement of migration.statements) {
            await client.query(statement)
          }

          await client.query(
            'INSERT INTO clawhost_schema_migrations (id, applied_at) VALUES ($1, NOW())',
            [migration.id],
          )
        }
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

  private async upsertControlPlaneInstance(
    client: PoolClient,
    input: ClawHostPostgresSyncInput,
  ) {
    const result = await client.query(
      `
        INSERT INTO clawhost_instances (
          instance_id,
          org_id,
          client_name,
          plan,
          status,
          deployment_mode,
          runtime_kind,
          config,
          skills,
          health_status,
          instance_layer,
          gateway_config,
          shared_experience_config,
          requested_im_channel,
          access_url,
          install_command,
          health_url,
          k8s_namespace,
          k8s_pod_name,
          host_port,
          runtime_image,
          container_id,
          container_name,
          last_health_message,
          connection_code_preview,
          connection_code_hash,
          connection_code_issued_at,
          connection_code_expires_at,
          bound_api_key_id,
          bound_api_key_prefix,
          bound_at,
          last_heartbeat_at,
          last_client_version,
          last_agent_id,
          heartbeat_capabilities,
          control_plane_source,
          cache_synced_at,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
          $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
          $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35::jsonb,
          'postgres', $36, COALESCE($37, NOW()), NOW()
        )
        ON CONFLICT (instance_id) DO UPDATE SET
          org_id = EXCLUDED.org_id,
          client_name = EXCLUDED.client_name,
          plan = EXCLUDED.plan,
          status = EXCLUDED.status,
          deployment_mode = EXCLUDED.deployment_mode,
          runtime_kind = EXCLUDED.runtime_kind,
          config = EXCLUDED.config,
          skills = EXCLUDED.skills,
          health_status = EXCLUDED.health_status,
          instance_layer = EXCLUDED.instance_layer,
          gateway_config = EXCLUDED.gateway_config,
          shared_experience_config = EXCLUDED.shared_experience_config,
          requested_im_channel = EXCLUDED.requested_im_channel,
          access_url = EXCLUDED.access_url,
          install_command = EXCLUDED.install_command,
          health_url = EXCLUDED.health_url,
          k8s_namespace = EXCLUDED.k8s_namespace,
          k8s_pod_name = EXCLUDED.k8s_pod_name,
          host_port = EXCLUDED.host_port,
          runtime_image = EXCLUDED.runtime_image,
          container_id = EXCLUDED.container_id,
          container_name = EXCLUDED.container_name,
          last_health_message = EXCLUDED.last_health_message,
          connection_code_preview = EXCLUDED.connection_code_preview,
          connection_code_hash = EXCLUDED.connection_code_hash,
          connection_code_issued_at = EXCLUDED.connection_code_issued_at,
          connection_code_expires_at = EXCLUDED.connection_code_expires_at,
          bound_api_key_id = EXCLUDED.bound_api_key_id,
          bound_api_key_prefix = EXCLUDED.bound_api_key_prefix,
          bound_at = EXCLUDED.bound_at,
          last_heartbeat_at = EXCLUDED.last_heartbeat_at,
          last_client_version = EXCLUDED.last_client_version,
          last_agent_id = EXCLUDED.last_agent_id,
          heartbeat_capabilities = EXCLUDED.heartbeat_capabilities,
          control_plane_source = EXCLUDED.control_plane_source,
          cache_synced_at = EXCLUDED.cache_synced_at,
          updated_at = NOW()
        RETURNING *
      `,
      [
        input.instanceId.trim(),
        input.orgId.trim(),
        input.clientName.trim(),
        input.plan?.trim() || 'starter',
        input.status.trim(),
        input.deploymentMode?.trim() || 'byoc',
        input.runtimeKind?.trim() || 'docker',
        JSON.stringify(input.config || {}),
        JSON.stringify(input.skills || []),
        JSON.stringify(input.healthStatus || {}),
        JSON.stringify(input.instanceLayer || {}),
        JSON.stringify(input.gatewayConfig || {}),
        JSON.stringify(input.sharedExperienceConfig || {}),
        input.requestedImChannel?.trim() || '',
        input.accessUrl?.trim() || '',
        input.installCommand?.trim() || '',
        input.healthUrl?.trim() || '',
        input.k8sNamespace?.trim() || '',
        input.k8sPodName?.trim() || '',
        Number.isFinite(input.hostPort) ? Number(input.hostPort) : 0,
        input.runtimeImage?.trim() || '',
        input.containerId?.trim() || '',
        input.containerName?.trim() || '',
        input.lastHealthMessage?.trim() || '',
        input.connectionCodePreview?.trim() || '',
        input.connectionCodeHash?.trim() || '',
        input.connectionCodeIssuedAt || null,
        input.connectionCodeExpiresAt || null,
        input.boundApiKeyId?.trim() || '',
        input.boundApiKeyPrefix?.trim() || '',
        input.boundAt || null,
        input.lastHeartbeatAt || null,
        input.lastClientVersion?.trim() || '',
        input.lastAgentId?.trim() || '',
        JSON.stringify(input.heartbeatCapabilities || []),
        input.cacheSyncedAt || null,
        input.createdAt || null,
      ],
    )

    return this.mapRecord(result.rows[0])
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
      lastAgentId: input.lastAgentId?.trim() || '',
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

  private mapRecord(row: Record<string, unknown> | undefined | null): ClawHostPostgresInstanceRecord | null {
    if (!row) {
      return null
    }

    return {
      instanceId: String(row['instance_id'] || ''),
      orgId: String(row['org_id'] || ''),
      clientName: String(row['client_name'] || ''),
      plan: String(row['plan'] || 'starter'),
      status: String(row['status'] || ''),
      deploymentMode: String(row['deployment_mode'] || 'byoc'),
      runtimeKind: String(row['runtime_kind'] || 'docker'),
      config: this.asObject(row['config']),
      skills: this.asInstalledSkills(row['skills']),
      healthStatus: this.asObject(row['health_status']),
      instanceLayer: this.asObject(row['instance_layer']),
      gatewayConfig: this.asObject(row['gateway_config']),
      sharedExperienceConfig: this.asObject(row['shared_experience_config']),
      requestedImChannel: String(row['requested_im_channel'] || ''),
      accessUrl: String(row['access_url'] || ''),
      installCommand: String(row['install_command'] || ''),
      healthUrl: String(row['health_url'] || ''),
      k8sNamespace: String(row['k8s_namespace'] || ''),
      k8sPodName: String(row['k8s_pod_name'] || ''),
      hostPort: Number(row['host_port'] || 0),
      runtimeImage: String(row['runtime_image'] || ''),
      containerId: String(row['container_id'] || ''),
      containerName: String(row['container_name'] || ''),
      lastHealthMessage: String(row['last_health_message'] || ''),
      connectionCodePreview: String(row['connection_code_preview'] || ''),
      connectionCodeHash: String(row['connection_code_hash'] || ''),
      connectionCodeIssuedAt: this.asDate(row['connection_code_issued_at']),
      connectionCodeExpiresAt: this.asDate(row['connection_code_expires_at']),
      boundApiKeyId: String(row['bound_api_key_id'] || ''),
      boundApiKeyPrefix: String(row['bound_api_key_prefix'] || ''),
      boundAt: this.asDate(row['bound_at']),
      lastHeartbeatAt: this.asDate(row['last_heartbeat_at']),
      lastClientVersion: String(row['last_client_version'] || ''),
      lastAgentId: String(row['last_agent_id'] || ''),
      heartbeatCapabilities: this.asStringArray(row['heartbeat_capabilities']),
      cacheSyncedAt: this.asDate(row['cache_synced_at']),
      createdAt: this.asDate(row['created_at']),
      updatedAt: this.asDate(row['updated_at']),
    }
  }

  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  }

  private asArray(value: unknown) {
    return Array.isArray(value)
      ? value as Array<Record<string, unknown>>
      : []
  }

  private asInstalledSkills(value: unknown): ClawHostInstalledSkillSnapshot[] {
    return this.asArray(value)
      .map(item => ({
        skillId: String(item['skillId'] || ''),
        version: String(item['version'] || ''),
        installedAt: this.asDate(item['installedAt']),
      }))
      .filter(item => item.skillId && item.version)
  }

  private asStringArray(value: unknown) {
    return Array.isArray(value)
      ? value.map(item => String(item)).filter(Boolean)
      : []
  }

  private asDate(value: unknown) {
    if (!value) {
      return null
    }

    if (value instanceof Date) {
      return value
    }

    const normalized = new Date(String(value))
    return Number.isNaN(normalized.getTime()) ? null : normalized
  }
}
