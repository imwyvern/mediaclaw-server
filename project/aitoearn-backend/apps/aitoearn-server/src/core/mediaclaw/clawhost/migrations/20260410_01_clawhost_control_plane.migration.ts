import { ClawHostPostgresMigration } from './clawhost-postgres.migration.types'

export const clawHostControlPlaneMigration: ClawHostPostgresMigration = {
  id: '20260410_01_clawhost_control_plane',
  statements: [
    `
      CREATE TABLE IF NOT EXISTS clawhost_instances (
        instance_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        client_name TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'starter',
        status TEXT NOT NULL,
        deployment_mode TEXT NOT NULL DEFAULT 'byoc',
        runtime_kind TEXT NOT NULL DEFAULT 'docker',
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        skills JSONB NOT NULL DEFAULT '[]'::jsonb,
        health_status JSONB NOT NULL DEFAULT '{}'::jsonb,
        gateway_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        shared_experience_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        requested_im_channel TEXT NOT NULL DEFAULT '',
        access_url TEXT NOT NULL DEFAULT '',
        install_command TEXT NOT NULL DEFAULT '',
        health_url TEXT NOT NULL DEFAULT '',
        k8s_namespace TEXT NOT NULL DEFAULT '',
        k8s_pod_name TEXT NOT NULL DEFAULT '',
        host_port INTEGER NOT NULL DEFAULT 0,
        runtime_image TEXT NOT NULL DEFAULT '',
        container_id TEXT NOT NULL DEFAULT '',
        container_name TEXT NOT NULL DEFAULT '',
        last_health_message TEXT NOT NULL DEFAULT '',
        connection_code_preview TEXT NOT NULL DEFAULT '',
        connection_code_hash TEXT NOT NULL DEFAULT '',
        connection_code_issued_at TIMESTAMPTZ NULL,
        connection_code_expires_at TIMESTAMPTZ NULL,
        bound_api_key_id TEXT NOT NULL DEFAULT '',
        bound_api_key_prefix TEXT NOT NULL DEFAULT '',
        bound_at TIMESTAMPTZ NULL,
        last_heartbeat_at TIMESTAMPTZ NULL,
        last_client_version TEXT NOT NULL DEFAULT '',
        last_agent_id TEXT NOT NULL DEFAULT '',
        heartbeat_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
        control_plane_source TEXT NOT NULL DEFAULT 'postgres',
        cache_synced_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_clawhost_instances_org_status_created
      ON clawhost_instances(org_id, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_clawhost_instances_bound_api_key
      ON clawhost_instances(bound_api_key_id)
      WHERE bound_api_key_id <> ''
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_clawhost_instances_last_agent
      ON clawhost_instances(org_id, last_agent_id)
      WHERE last_agent_id <> ''
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_clawhost_instances_runtime_host_port
      ON clawhost_instances(runtime_kind, host_port)
      WHERE host_port > 0
    `,
    `
      CREATE TABLE IF NOT EXISTS apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_token TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
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
    `,
    `
      CREATE TABLE IF NOT EXISTS bot_channels (
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        channel_type TEXT NOT NULL,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (bot_id, channel_type)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS bot_devices (
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        approved BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (bot_id, device_id)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_bots_app_id
      ON bots(app_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_bots_status
      ON bots(status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_bot_channels_type
      ON bot_channels(channel_type)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_bot_devices_approved
      ON bot_devices(approved)
    `,
  ],
}
