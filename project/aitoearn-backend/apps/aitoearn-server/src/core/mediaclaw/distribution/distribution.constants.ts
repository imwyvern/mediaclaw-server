export enum DistributionPublishStatus {
  COMPLETED = 'completed',
  PUSHED = 'pushed',
  PUBLISHED = 'published',
  EXPIRED = 'expired',
}

export function isDistributionPublishStatus(value: unknown): value is DistributionPublishStatus {
  return typeof value === 'string'
    && Object.values(DistributionPublishStatus).includes(value as DistributionPublishStatus)
}
