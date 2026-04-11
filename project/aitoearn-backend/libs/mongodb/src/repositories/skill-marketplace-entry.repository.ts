import { InjectModel } from '@nestjs/mongoose'
import { FilterQuery, Model, SortOrder, Types, UpdateQuery } from 'mongoose'
import { SkillMarketplaceEntry } from '../schemas'
import { BaseRepository, LeanDoc } from './base.repository'

export class SkillMarketplaceEntryRepository extends BaseRepository<SkillMarketplaceEntry> {
  constructor(
    @InjectModel(SkillMarketplaceEntry.name) skillMarketplaceEntryModel: Model<SkillMarketplaceEntry>,
  ) {
    super(skillMarketplaceEntryModel)
  }

  async upsertByOwnerAndVersion(
    ownerOrgId: Types.ObjectId,
    skillId: string,
    version: string,
    payload: Partial<SkillMarketplaceEntry>,
  ): Promise<LeanDoc<SkillMarketplaceEntry> | null> {
    return this.model.findOneAndUpdate(
      {
        ownerOrgId,
        skillId,
        version,
      },
      {
        $set: payload,
        $setOnInsert: {
          ownerOrgId,
          installs: 0,
          rating: 0,
          reviewCount: 0,
          reviews: [],
          installHistory: [],
        },
      },
      {
        upsert: true,
        new: true,
      },
    ).lean({ virtuals: true }).exec()
  }

  async listByQuery(
    query: FilterQuery<SkillMarketplaceEntry>,
    sort: [string, SortOrder][],
    page: number,
    limit: number,
  ): Promise<readonly [LeanDoc<SkillMarketplaceEntry>[], number]> {
    const skip = (page - 1) * limit

    const [items, total] = await Promise.all([
      this.model.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean({ virtuals: true })
        .exec() as Promise<LeanDoc<SkillMarketplaceEntry>[]>,
      this.model.countDocuments(query).exec(),
    ])

    return [items, total] as const
  }

  async findLatest(query: FilterQuery<SkillMarketplaceEntry>): Promise<LeanDoc<SkillMarketplaceEntry> | null> {
    return this.model.findOne(query)
      .sort({ updatedAt: -1 })
      .lean({ virtuals: true })
      .exec()
  }

  async updateEntry(
    id: string,
    update: UpdateQuery<SkillMarketplaceEntry>,
  ): Promise<LeanDoc<SkillMarketplaceEntry> | null> {
    return this.updateById(id, update)
  }
}
