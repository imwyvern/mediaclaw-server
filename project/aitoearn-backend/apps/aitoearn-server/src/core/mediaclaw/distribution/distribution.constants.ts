export enum DistributionPublishStatus {
  COMPLETED = 'completed',
  PUSHED = 'pushed',
  PUBLISHED = 'published',
  EXPIRED = 'expired',
}

export enum DistributionLifecycleStatus {
  CREATED = 'created',
  PROCESSING = 'processing',
  READY = 'ready',
  PUSHED = 'pushed',
  PUBLISHED = 'published',
  EXPIRED = 'expired',
}

export enum DistributionCallbackStatus {
  PROCESSING = 'processing',
  READY = 'ready',
  PUBLISHED = 'published',
  REJECTED = 'rejected',
}

export function isDistributionPublishStatus(value: unknown): value is DistributionPublishStatus {
  return typeof value === 'string'
    && Object.values(DistributionPublishStatus).includes(value as DistributionPublishStatus)
}

export function isDistributionLifecycleStatus(value: unknown): value is DistributionLifecycleStatus {
  return typeof value === 'string'
    && Object.values(DistributionLifecycleStatus).includes(value as DistributionLifecycleStatus)
}
