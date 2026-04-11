import { InjectModel } from '@nestjs/mongoose'
import { FilterQuery, Model, SortOrder, Types, UpdateQuery } from 'mongoose'
import { MarketplaceTemplate } from '../schemas'
import { BaseRepository, LeanDoc } from './base.repository'

export class MarketplaceTemplateRepository extends BaseRepository<MarketplaceTemplate> {
  constructor(
    @InjectModel(MarketplaceTemplate.name) marketplaceTemplateModel: Model<MarketplaceTemplate>,
  ) {
    super(marketplaceTemplateModel)
  }

  async upsertPublishedTemplate(
    authorOrgId: Types.ObjectId,
    pipelineTemplateId: Types.ObjectId,
    payload: Partial<MarketplaceTemplate>,
  ): Promise<LeanDoc<MarketplaceTemplate> | null> {
    return this.model.findOneAndUpdate(
      {
        pipelineTemplateId,
        authorOrgId,
      },
      {
        $set: payload,
        $setOnInsert: {
          pipelineTemplateId,
          authorOrgId,
          downloads: 0,
          rating: 0,
          reviewCount: 0,
          isFeatured: false,
          reviews: [],
          purchaseHistory: [],
        },
      },
      {
        upsert: true,
        new: true,
      },
    ).lean({ virtuals: true }).exec()
  }

  async listByQuery(
    query: FilterQuery<MarketplaceTemplate>,
    sort: [string, SortOrder][],
    page: number,
    limit: number,
  ): Promise<readonly [LeanDoc<MarketplaceTemplate>[], number]> {
    const skip = (page - 1) * limit

    const [items, total] = await Promise.all([
      this.model.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean({ virtuals: true })
        .exec() as Promise<LeanDoc<MarketplaceTemplate>[]>,
      this.model.countDocuments(query).exec(),
    ])

    return [items, total] as const
  }

  async updateTemplate(
    id: string,
    update: UpdateQuery<MarketplaceTemplate>,
  ): Promise<LeanDoc<MarketplaceTemplate> | null> {
    return this.updateById(id, update)
  }
}
