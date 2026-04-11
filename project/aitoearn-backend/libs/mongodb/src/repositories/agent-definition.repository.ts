import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { AgentDefinition } from '../schemas'
import { BaseRepository, LeanDoc } from './base.repository'

export class AgentDefinitionRepository extends BaseRepository<AgentDefinition> {
  constructor(
    @InjectModel(AgentDefinition.name) agentDefinitionModel: Model<AgentDefinition>,
  ) {
    super(agentDefinitionModel)
  }

  async listActive(): Promise<LeanDoc<AgentDefinition>[]> {
    return this.model.find({
      status: { $ne: 'archived' },
    }).sort({
      agentId: 1,
      isDefault: -1,
      createdAt: -1,
    }).lean({ virtuals: true }).exec()
  }

  async listActiveByAgentId(agentId: string): Promise<LeanDoc<AgentDefinition>[]> {
    return this.model.find({
      agentId,
      status: { $ne: 'archived' },
    }).sort({
      isDefault: -1,
      createdAt: -1,
    }).lean({ virtuals: true }).exec()
  }

  async getByAgentIdAndVersion(agentId: string, version: string): Promise<LeanDoc<AgentDefinition> | null> {
    return this.model.findOne({
      agentId,
      version,
      status: { $ne: 'archived' },
    }).lean({ virtuals: true }).exec()
  }

  async upsertByAgentVersion(
    agentId: string,
    version: string,
    payload: Partial<AgentDefinition>,
  ): Promise<LeanDoc<AgentDefinition> | null> {
    return this.model.findOneAndUpdate(
      { agentId, version },
      {
        $set: payload,
        $setOnInsert: {
          agentId,
          version,
        },
      },
      {
        upsert: true,
        new: true,
      },
    ).lean({ virtuals: true }).exec()
  }
}
