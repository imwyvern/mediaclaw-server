export const MEDIACLAW_DISTRIBUTION_QUEUE = 'mediaclaw_distribution'

export const MEDIACLAW_DISTRIBUTION_EXPIRE_SCHEDULER
  = 'distribution-expire-stale-every-hour'
export const MEDIACLAW_DISTRIBUTION_EXPIRE_CRON = '0 * * * *'

export const DISTRIBUTION_JOB_DISPATCH_COMPLETED = 'dispatch-completed-task'
export const DISTRIBUTION_JOB_EXPIRE_STALE = 'expire-stale-distributions'

export interface DistributionJobData {
  taskId?: string
  trigger?: 'task-completed' | 'scheduled' | 'manual'
  requestedAt?: string
  source?: string
}
