import { ClawHostPostgresMigration } from './clawhost-postgres.migration.types'

export const clawHostInstanceLayerMigration: ClawHostPostgresMigration = {
  id: '20260410_02_clawhost_instance_layer',
  statements: [
    `
      ALTER TABLE clawhost_instances
      ADD COLUMN IF NOT EXISTS instance_layer JSONB NOT NULL DEFAULT '{}'::jsonb
    `,
  ],
}
