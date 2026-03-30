import { InjectQueue } from '@nestjs/bullmq'
import { BadRequestException, Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'
import { VIDEO_WORKER_QUEUE, VIDEO_WORKER_STEPS, VideoWorkerJobData, VideoWorkerStep } from '../worker/worker.constants'

interface HeartbeatInput {
  clientVersion?: string
  agentId?: string
  capabilities?: string[]
}

interface HeartbeatUser {
  id?: string
  orgId?: string | null
  apiKeyId?: string
  authType?: string
}

interface AgentHeartbeatState {
  agentId: string
  clientVersion: string
  capabilities: string[]
  lastHeartbeatAt: string
  userId: string | null
  orgId: string | null
  apiKeyId: string | null
  authType: string | null
}

interface AgentConfigUpdate {
  key: string
  value: unknown
  updatedAt: string
}

interface PendingQueueTask {
  jobId: string
  taskId: string
  step: VideoWorkerStep
  state: string
  queuedAt: string | null
  delayUntil: string | null
  attemptsMade: number
  maxAttempts: number
}

@Injectable()
export class HealthService {
  private readonly agentHeartbeatMap = new Map<string, AgentHeartbeatState>()
  private readonly configUpdateMap = new Map<string, AgentConfigUpdate[]>()

  constructor(
    @InjectQueue(VIDEO_WORKER_QUEUE)
    private readonly videoWorkerQueue: Queue<VideoWorkerJobData>,
  ) {}

  async heartbeat(user: HeartbeatUser | undefined, input: HeartbeatInput) {
    const agentId = input.agentId?.trim()
    if (!agentId) {
      throw new BadRequestException('agentId is required')
    }

    const clientVersion = input.clientVersion?.trim() || 'unknown'
    const capabilities = this.normalizeCapabilities(input.capabilities)
    const acknowledgedAt = new Date().toISOString()

    this.agentHeartbeatMap.set(agentId, {
      agentId,
      clientVersion,
      capabilities,
      lastHeartbeatAt: acknowledgedAt,
      userId: user?.id || null,
      orgId: user?.orgId || null,
      apiKeyId: user?.apiKeyId || null,
      authType: user?.authType || null,
    })

    return {
      status: 'ok',
      agentId,
      acknowledgedAt,
      lastHeartbeatAt: acknowledgedAt,
      pendingTasks: await this.getPendingTasks(capabilities),
      configUpdates: this.drainConfigUpdates(agentId),
    }
  }

  listAgentHeartbeats() {
    return Array.from(this.agentHeartbeatMap.values()).sort((left, right) =>
      new Date(right.lastHeartbeatAt).getTime() - new Date(left.lastHeartbeatAt).getTime(),
    )
  }

  private async getPendingTasks(capabilities: string[]): Promise<PendingQueueTask[]> {
    const states = ['waiting', 'prioritized', 'delayed'] as const
    const groups = await Promise.all(
      states.map(async state => ({
        state,
        jobs: await this.videoWorkerQueue.getJobs([state], 0, 49, true),
      })),
    )

    return groups
      .flatMap(({ state, jobs }) =>
        jobs
          .flatMap((job) => {
            if (!this.isSupportedStep(job.name) || !this.matchesCapabilities(job.name, capabilities)) {
              return []
            }

            return [{
              jobId: String(job.id || ''),
              taskId: job.data.taskId,
              step: job.name,
              state,
              queuedAt: typeof job.timestamp === 'number' ? new Date(job.timestamp).toISOString() : null,
              delayUntil: typeof job.delay === 'number' && job.delay > 0
                ? new Date(job.timestamp + job.delay).toISOString()
                : null,
              attemptsMade: job.attemptsMade,
              maxAttempts: job.opts.attempts ?? 1,
            }]
          }),
      )
      .sort((left, right) => {
        const leftTime = left.queuedAt ? new Date(left.queuedAt).getTime() : 0
        const rightTime = right.queuedAt ? new Date(right.queuedAt).getTime() : 0
        return leftTime - rightTime
      })
  }

  private normalizeCapabilities(capabilities?: string[]): string[] {
    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      return []
    }

    return [...new Set(capabilities.map(item => item.trim()).filter(Boolean))]
  }

  private matchesCapabilities(step: VideoWorkerStep, capabilities: string[]): boolean {
    if (capabilities.length === 0) {
      return true
    }

    return capabilities.includes('*') || capabilities.includes(step)
  }

  private isSupportedStep(step: string): step is VideoWorkerStep {
    return (VIDEO_WORKER_STEPS as readonly string[]).includes(step)
  }

  private drainConfigUpdates(agentId: string): AgentConfigUpdate[] {
    const updates = this.configUpdateMap.get(agentId) || []
    this.configUpdateMap.delete(agentId)
    return updates
  }
}
