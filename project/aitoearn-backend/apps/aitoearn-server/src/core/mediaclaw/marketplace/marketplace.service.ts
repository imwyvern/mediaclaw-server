import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  MarketplaceCurrency,
  MarketplaceTemplate,
  PipelineTemplate,
} from '@yikart/mongodb'
import { Model, SortOrder, Types } from 'mongoose'

interface MarketplaceFilters {
  search?: string
  tag?: string
  isFeatured?: boolean
  isApproved?: boolean
  authorOrgId?: string
  priceType?: 'free' | 'paid'
}

interface PaginationInput {
  page?: number
  limit?: number
}

@Injectable()
export class MarketplaceService {
  constructor(
    @InjectModel(MarketplaceTemplate.name)
    private readonly marketplaceTemplateModel: Model<MarketplaceTemplate>,
    @InjectModel(PipelineTemplate.name)
    private readonly pipelineTemplateModel: Model<PipelineTemplate>,
  ) {}

  async publishTemplate(
    orgId: string,
    pipelineTemplateId: string,
    data: {
      title?: string
      description?: string
      thumbnailUrl?: string
      tags?: string[]
      price?: number
      currency?: MarketplaceCurrency
    },
  ) {
    const pipelineTemplate = await this.pipelineTemplateModel.findById(pipelineTemplateId).lean().exec()
    if (!pipelineTemplate) {
      throw new NotFoundException('Pipeline template not found')
    }

    const published = await this.marketplaceTemplateModel.findOneAndUpdate(
      {
        pipelineTemplateId: new Types.ObjectId(pipelineTemplateId),
        authorOrgId: new Types.ObjectId(orgId),
      },
      {
        $set: {
          title: data.title?.trim() || pipelineTemplate.name,
          description: data.description || '',
          thumbnailUrl: data.thumbnailUrl || '',
          tags: this.normalizeTags(data.tags),
          price: Math.max(data.price || 0, 0),
          currency: data.currency || MarketplaceCurrency.CNY,
          isApproved: false,
        },
        $setOnInsert: {
          pipelineTemplateId: new Types.ObjectId(pipelineTemplateId),
          authorOrgId: new Types.ObjectId(orgId),
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
    ).lean().exec()

    return this.toResponse(published, true)
  }

  async listTemplates(
    filters: MarketplaceFilters,
    sort: string | undefined,
    pagination: PaginationInput,
  ) {
    const page = Math.max(Number(pagination.page || 1), 1)
    const limit = Math.min(Math.max(Number(pagination.limit || 20), 1), 100)
    const skip = (page - 1) * limit
    const query = this.buildListQuery(filters)
    const sortOption = this.resolveSort(sort)

    const [items, total] = await Promise.all([
      this.marketplaceTemplateModel.find(query)
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.marketplaceTemplateModel.countDocuments(query),
    ])

    return {
      items: items.map(item => this.toResponse(item)),
      total,
      page,
      limit,
    }
  }

  async getTemplate(id: string) {
    const template = await this.marketplaceTemplateModel.findById(id).lean().exec()
    if (!template) {
      throw new NotFoundException('Marketplace template not found')
    }

    return this.toResponse(template, true)
  }

  async purchaseTemplate(orgId: string, templateId: string) {
    const template = await this.marketplaceTemplateModel.findById(templateId).lean().exec()
    if (!template) {
      throw new NotFoundException('Marketplace template not found')
    }
    if (!template.isApproved && template.authorOrgId.toString() !== orgId) {
      throw new BadRequestException('Template is not approved')
    }

    const hasPurchased = template.purchaseHistory?.some(
      purchase => purchase.orgId.toString() === orgId,
    )

    if (!hasPurchased) {
      await this.marketplaceTemplateModel.findByIdAndUpdate(templateId, {
        $inc: { downloads: 1 },
        $push: {
          purchaseHistory: {
            orgId: new Types.ObjectId(orgId),
            purchasedAt: new Date(),
          },
        },
      }).exec()
    }

    const latest = await this.marketplaceTemplateModel.findById(templateId).lean().exec()
    return {
      purchased: true,
      alreadyPurchased: hasPurchased,
      price: latest?.price || 0,
      currency: latest?.currency || MarketplaceCurrency.CNY,
      template: this.toResponse(latest),
    }
  }

  async rateTemplate(orgId: string, templateId: string, rating: number, review: string) {
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5')
    }

    const template = await this.marketplaceTemplateModel.findById(templateId).lean().exec()
    if (!template) {
      throw new NotFoundException('Marketplace template not found')
    }

    const reviews: Array<Record<string, any>> = [...(template.reviews || [])]
    const existingIndex = reviews.findIndex(item => item['orgId'].toString() === orgId)
    const nextReview = {
      orgId: new Types.ObjectId(orgId),
      rating,
      review: review?.trim() || '',
      createdAt: existingIndex >= 0 ? reviews[existingIndex]['createdAt'] : new Date(),
      updatedAt: new Date(),
    }

    if (existingIndex >= 0) {
      reviews[existingIndex] = nextReview
    }
    else {
      reviews.push(nextReview)
    }

    const reviewCount = reviews.length
    const averageRating = reviewCount > 0
      ? Number((reviews.reduce((sum, item) => sum + item['rating'], 0) / reviewCount).toFixed(2))
      : 0

    const updated = await this.marketplaceTemplateModel.findByIdAndUpdate(
      templateId,
      {
        reviews,
        rating: averageRating,
        reviewCount,
      },
      { new: true },
    ).lean().exec()

    return this.toResponse(updated, true)
  }

  async featureTemplate(id: string) {
    const updated = await this.marketplaceTemplateModel.findByIdAndUpdate(
      id,
      {
        isFeatured: true,
        isApproved: true,
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Marketplace template not found')
    }

    return this.toResponse(updated, true)
  }

  private buildListQuery(filters: MarketplaceFilters) {
    const query: Record<string, any> = {
      isApproved: filters.isApproved ?? true,
    }

    if (filters.search?.trim()) {
      query['$or'] = [
        { title: new RegExp(filters.search.trim(), 'i') },
        { description: new RegExp(filters.search.trim(), 'i') },
      ]
    }

    if (filters.tag?.trim()) {
      query['tags'] = filters.tag.trim()
    }

    if (typeof filters.isFeatured === 'boolean') {
      query['isFeatured'] = filters.isFeatured
    }

    if (filters.authorOrgId && Types.ObjectId.isValid(filters.authorOrgId)) {
      query['authorOrgId'] = new Types.ObjectId(filters.authorOrgId)
    }

    if (filters.priceType === 'free') {
      query['price'] = 0
    }

    if (filters.priceType === 'paid') {
      query['price'] = { $gt: 0 }
    }

    return query
  }

  private resolveSort(sort?: string) {
    const descending: SortOrder = -1

    switch (sort) {
      case 'downloads':
        return [['downloads', descending], ['createdAt', descending]] as [string, SortOrder][]
      case 'rating':
        return [['rating', descending], ['reviewCount', descending], ['createdAt', descending]] as [string, SortOrder][]
      case 'newest':
        return [['createdAt', descending]] as [string, SortOrder][]
      case 'featured':
      default:
        return [
          ['isFeatured', descending],
          ['rating', descending],
          ['downloads', descending],
          ['createdAt', descending],
        ] as [string, SortOrder][]
    }
  }

  private normalizeTags(tags?: string[]) {
    return [...new Set((tags || []).map(tag => tag.trim()).filter(Boolean))]
  }

  private toResponse(template: {
    _id: { toString: () => string }
    pipelineTemplateId: { toString: () => string }
    authorOrgId: { toString: () => string }
    title: string
    description: string
    thumbnailUrl: string
    tags: string[]
    price: number
    currency: MarketplaceCurrency
    downloads: number
    rating: number
    reviewCount: number
    isApproved: boolean
    isFeatured: boolean
    reviews?: Array<{
      orgId: { toString: () => string }
      rating: number
      review: string
      createdAt: Date
      updatedAt: Date
    }>
    purchaseHistory?: Array<{
      orgId: { toString: () => string }
      purchasedAt: Date
    }>
    createdAt?: Date
    updatedAt?: Date
  } | null, includeDetails = false) {
    if (!template) {
      throw new NotFoundException('Marketplace template not found')
    }

    return {
      id: template._id.toString(),
      pipelineTemplateId: template.pipelineTemplateId.toString(),
      authorOrgId: template.authorOrgId.toString(),
      title: template.title,
      description: template.description,
      thumbnailUrl: template.thumbnailUrl,
      tags: template.tags || [],
      price: template.price,
      currency: template.currency,
      downloads: template.downloads,
      rating: template.rating,
      reviewCount: template.reviewCount,
      isApproved: template.isApproved,
      isFeatured: template.isFeatured,
      reviews: includeDetails
        ? (template.reviews || []).map(review => ({
            orgId: review.orgId.toString(),
            rating: review.rating,
            review: review.review,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
          }))
        : undefined,
      purchaseHistory: includeDetails
        ? (template.purchaseHistory || []).map(item => ({
            orgId: item.orgId.toString(),
            purchasedAt: item.purchasedAt,
          }))
        : undefined,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }
  }
}
