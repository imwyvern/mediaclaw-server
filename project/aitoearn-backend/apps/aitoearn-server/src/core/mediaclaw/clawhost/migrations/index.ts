import { clawHostControlPlaneMigration } from './20260410_01_clawhost_control_plane.migration'
import { clawHostInstanceLayerMigration } from './20260410_02_clawhost_instance_layer.migration'

export const CLAWHOST_POSTGRES_MIGRATIONS = [
  clawHostControlPlaneMigration,
  clawHostInstanceLayerMigration,
]

export * from './clawhost-postgres.migration.types'
