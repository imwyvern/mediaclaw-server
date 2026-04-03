import { VideoTaskStatus } from '@yikart/mongodb'

export type VideoTaskProductionStage =
  | 'draft'
  | 'queued'
  | 'processing'
  | 'review'
  | 'approved'
  | 'delivered'
  | 'failed'
  | 'cancelled'

export function mapVideoTaskStatusToProductionStage(status: VideoTaskStatus): VideoTaskProductionStage {
  switch (status) {
    case VideoTaskStatus.DRAFT:
      return 'draft'
    case VideoTaskStatus.PENDING:
      return 'queued'
    case VideoTaskStatus.ANALYZING:
    case VideoTaskStatus.EDITING:
    case VideoTaskStatus.RENDERING:
    case VideoTaskStatus.QUALITY_CHECK:
    case VideoTaskStatus.GENERATING_COPY:
      return 'processing'
    case VideoTaskStatus.COMPLETED:
    case VideoTaskStatus.PENDING_REVIEW:
    case VideoTaskStatus.REJECTED:
      return 'review'
    case VideoTaskStatus.APPROVED:
      return 'approved'
    case VideoTaskStatus.PUBLISHED:
      return 'delivered'
    case VideoTaskStatus.FAILED:
      return 'failed'
    case VideoTaskStatus.CANCELLED:
      return 'cancelled'
    default:
      return 'processing'
  }
}

export function createStatusTransitionIterationEntry(
  existingEntries: Array<Record<string, any>> | undefined,
  input: {
    fromStatus?: VideoTaskStatus | null
    toStatus: VideoTaskStatus
    timestamp?: Date
    detail?: Record<string, any>
  },
) {
  const timestamp = input.timestamp || new Date()
  const step = `status:${input.toStatus}`
  const attempt = (existingEntries || []).filter(entry => entry?.['step'] === step).length + 1
  const productionStage = mapVideoTaskStatusToProductionStage(input.toStatus)

  return {
    step,
    status: 'completed',
    input: {
      fromStatus: input.fromStatus || null,
      toStatus: input.toStatus,
      productionStage,
      ...(input.detail || {}),
    },
    output: {
      rawStatus: input.toStatus,
      productionStage,
    },
    error: '',
    duration: 0,
    attempt,
    timestamps: {
      startedAt: timestamp,
      completedAt: timestamp,
    },
  }
}
