import { Injectable, Logger } from '@nestjs/common'
import { PaymentOrder, VideoTask } from '@yikart/mongodb'
import { WebhookService } from '../webhook/webhook.service'

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name)

  constructor(private readonly webhookService: WebhookService) {}

  async notifyTaskComplete(task: VideoTask) {
    this.logger.log({
      message: 'MediaClaw task completion notification queued',
      taskId: task._id?.toString(),
      userId: task.userId,
      orgId: task.orgId?.toString() || null,
      outputVideoUrl: task.outputVideoUrl,
      channel: 'stub',
      target: task.metadata?.['webhookUrl'] || task.metadata?.['imGroupId'] || null,
    })

    await this.webhookService.trigger('task.completed', {
      taskId: task._id?.toString(),
      userId: task.userId,
      orgId: task.orgId?.toString() || null,
      brandId: task.brandId?.toString() || null,
      pipelineId: task.pipelineId?.toString() || null,
      status: task.status,
      outputVideoUrl: task.outputVideoUrl,
      completedAt: task.completedAt,
      copy: task.copy,
      quality: task.quality,
      metadata: task.metadata,
    })
  }

  async notifyPaymentSuccess(order: PaymentOrder) {
    this.logger.log({
      message: 'MediaClaw payment success notification queued',
      orderNo: order.orderNo,
      userId: order.userId,
      orgId: order.orgId?.toString() || null,
      amountCents: order.amountCents,
      status: order.status,
      channel: 'stub',
      target: order.callbackData?.['webhookUrl'] || order.callbackData?.['imGroupId'] || null,
    })

    await this.webhookService.trigger('payment.success', {
      orderNo: order.orderNo,
      userId: order.userId,
      orgId: order.orgId?.toString() || null,
      amountCents: order.amountCents,
      status: order.status,
      paidAt: order.paidAt,
      callbackData: order.callbackData,
    })
  }
}
