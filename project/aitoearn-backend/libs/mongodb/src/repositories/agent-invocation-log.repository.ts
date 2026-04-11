import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { AgentInvocationLog } from '../schemas'
import { BaseRepository, LeanDoc } from './base.repository'

interface AgentInvocationLogPagination {
  page: number
  pageSize: number
  status?: 'running' | 'success' | 'failed'
}

export class AgentInvocationLogRepository extends BaseRepository<AgentInvocationLog> {
  constructor(
    @InjectModel(AgentInvocationLog.name) agentInvocationLogModel: Model<AgentInvocationLog>,
  ) {
    super(agentInvocationLogModel)
  }

  async listByAgentIdWithPagination(agentId: string, pagination: AgentInvocationLogPagination) {
    return this.findWithPagination({
      page: pagination.page,
      pageSize: pagination.pageSize,
      filter: {
        agentId,
        ...(pagination.status ? { status: pagination.status } : {}),
      },
      options: { sort: { createdAt: -1 } },
    })
  }

  async getByInvocationId(invocationId: string): Promise<LeanDoc<AgentInvocationLog> | null> {
    return this.model.findOne({
      invocationId,
    }).lean({ virtuals: true }).exec()
  }

  async updateByInvocationId(
    invocationId: string,
    payload: Partial<AgentInvocationLog>,
  ): Promise<LeanDoc<AgentInvocationLog> | null> {
    return this.model.findOneAndUpdate(
      { invocationId },
      payload,
      { new: true },
    ).lean({ virtuals: true }).exec()
  }
}
