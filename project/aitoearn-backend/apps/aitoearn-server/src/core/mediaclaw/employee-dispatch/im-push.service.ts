import { DeliveryChannel, DeliveryRecordStatus } from '@yikart/mongodb'

export interface DispatchVideoCard {
  videoTaskId: string
  title: string
  description: string
  copy: string
  coverUrl: string
  outputVideoUrl: string
  publishGuide: string
  publishPlatforms: string[]
  primaryPlatform: string
  tags: string[]
}

export type ImTemplateKind = 'video-card' | 'approval-card' | 'report-card'

export interface ImTemplateAction {
  key: string
  text: string
  url?: string
  value?: string
}

export interface ImTemplateMessage {
  kind: ImTemplateKind
  title: string
  summary: string
  body: string[]
  metrics?: Array<{
    label: string
    value: string
  }>
  actions?: ImTemplateAction[]
  metadata?: Record<string, unknown>
}

export interface DispatchEmployeeTarget {
  assignmentId: string
  employeeName: string
  employeePhone: string
  webhookUrl: string
}

export interface WebhookDeliveryRecord {
  id: string
  orgId: string
  videoTaskId: string
  employeeAssignmentId: string
  deliveryChannel: DeliveryChannel
}

export interface ImPushContext<TBinding = Record<string, unknown>> {
  binding: TBinding
  target: DispatchEmployeeTarget
  deliveryRecord: WebhookDeliveryRecord
}

export interface ImPushResult {
  success: boolean
  payload: Record<string, unknown>
  errorMessage?: string
  retryCount?: number
  manualPickupRequired?: boolean
  status?: DeliveryRecordStatus
  deliveredAt?: Date | null
}

export interface ImPushService<TBinding = Record<string, unknown>> {
  readonly channel: DeliveryChannel
  pushVideoCard: (context: ImPushContext<TBinding>, videoData: DispatchVideoCard) => Promise<ImPushResult>
  pushTemplateMessage: (
    context: ImPushContext<TBinding>,
    message: ImTemplateMessage,
  ) => Promise<ImPushResult>
}
