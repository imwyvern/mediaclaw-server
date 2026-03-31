import { VideoTaskStatus } from '@yikart/mongodb'

export const MEDIACLAW_SUCCESS_STATUSES = [
  VideoTaskStatus.COMPLETED,
  VideoTaskStatus.APPROVED,
  VideoTaskStatus.PUBLISHED,
] as const

export const MEDIACLAW_DISTRIBUTABLE_STATUSES = [
  VideoTaskStatus.COMPLETED,
  VideoTaskStatus.APPROVED,
  VideoTaskStatus.PUBLISHED,
] as const

export const MEDIACLAW_PENDING_TASK_STATUSES = [
  VideoTaskStatus.PENDING,
  VideoTaskStatus.ANALYZING,
  VideoTaskStatus.EDITING,
  VideoTaskStatus.RENDERING,
  VideoTaskStatus.QUALITY_CHECK,
  VideoTaskStatus.GENERATING_COPY,
  VideoTaskStatus.PENDING_REVIEW,
] as const

export function isMediaclawSuccessStatus(status: VideoTaskStatus | null | undefined) {
  return MEDIACLAW_SUCCESS_STATUSES.includes(status as (typeof MEDIACLAW_SUCCESS_STATUSES)[number])
}

export function isDistributableVideoTaskStatus(status: VideoTaskStatus | null | undefined) {
  return MEDIACLAW_DISTRIBUTABLE_STATUSES.includes(status as (typeof MEDIACLAW_DISTRIBUTABLE_STATUSES)[number])
}

