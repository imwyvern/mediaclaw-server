import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { ApiKey } from '../schemas'
import { BaseRepository } from './base.repository'

export class ApiKeyRepository extends BaseRepository<ApiKey> {
  constructor(
    @InjectModel(ApiKey.name) apiKeyModel: Model<ApiKey>,
  ) {
    super(apiKeyModel)
  }

  async getByHashedKeys(keys: string[]) {
    return await this.findOne({ $or: [{ key: { $in: keys } }, { keyHash: { $in: keys } }] })
  }

  async listByUserId(userId: string, includeInactive = false) {
    return await this.find(includeInactive ? { userId } : { userId, isActive: true })
  }

  async updateLastUsedAt(id: string) {
    await this.updateById(id, { lastUsedAt: new Date() })
  }

  async deleteByIdAndUserId(id: string, userId: string) {
    await this.deleteOne({ _id: id, userId })
  }
}
