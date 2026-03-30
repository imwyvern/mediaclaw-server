import { Injectable, Logger } from '@nestjs/common'
import { PaymentOrder, VideoTask } from '@yikart/mongodb'

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name)

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
  }
}
