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
  readonly channel: DeliveryChannel.FEISHU | DeliveryChannel.WECOM
  pushVideoCard(context: ImPushContext<TBinding>, videoData: DispatchVideoCard): Promise<ImPushResult>
}
