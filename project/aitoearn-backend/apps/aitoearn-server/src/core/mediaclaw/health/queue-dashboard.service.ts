import type { NextFunction, Request, Response } from 'express'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { InjectQueue } from '@nestjs/bullmq'
import { HttpException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Queue } from 'bullmq'
import { VIDEO_WORKER_QUEUE, VideoWorkerJobData } from '../worker/worker.constants'
import { QueueDashboardJwtPayload } from './queue-dashboard-auth.service'
import { QueueDashboardAuthService } from './queue-dashboard-auth.service'

type QueueDashboardRequest = Request & {
  user?: QueueDashboardJwtPayload
}

@Injectable()
export class QueueDashboardService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueDashboardService.name)
  private readonly basePath = '/api/v1/admin/queues'
  private mounted = false

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly queueDashboardAuthService: QueueDashboardAuthService,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    private readonly videoWorkerQueue: Queue<VideoWorkerJobData>,
  ) {}

  onApplicationBootstrap() {
    if (this.mounted) {
      return
    }

    const serverAdapter = new ExpressAdapter()
    serverAdapter.setBasePath(this.basePath)

    createBullBoard({
      queues: [new BullMQAdapter(this.videoWorkerQueue)],
      serverAdapter,
    })

    const app = this.httpAdapterHost.httpAdapter.getInstance()
    app.use(
      this.basePath,
      (request: Request, response: Response, next: NextFunction) => {
        try {
          ;(request as QueueDashboardRequest).user = this.queueDashboardAuthService.authorize(request)
          next()
        } catch (error) {
          this.handleAuthorizationError(error, response)
        }
      },
      serverAdapter.getRouter(),
    )

    this.mounted = true
    this.logger.log(`Bull Board mounted at ${this.basePath}`)
  }

  private handleAuthorizationError(error: unknown, response: Response) {
    if (error instanceof HttpException) {
      const status = error.getStatus()
      response.status(status).json({
        statusCode: status,
        message: error.message,
      })
      return
    }

    response.status(500).json({
      statusCode: 500,
      message: 'Queue dashboard authorization failed',
    })
  }
}
