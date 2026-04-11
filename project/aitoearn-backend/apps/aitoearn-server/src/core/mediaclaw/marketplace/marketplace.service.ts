import type { LeanDoc } from '@yikart/mongodb'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {

  MarketplaceCurrency,
  MarketplaceTemplate,
  MarketplaceTemplateRepository,
  PipelineTemplateRepository,
} from '@yikart/mongodb'
import { FilterQuery, SortOrder, Types } from 'mongoose'

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

interface MarketplaceReviewSnapshot {
  orgId: string
  rating: number
  review: string
  createdAt: Date
  updatedAt: Date
}

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly marketplaceTemplateRepository: MarketplaceTemplateRepository,
    private readonly pipelineTemplateRepository: PipelineTemplateRepository,
  ) {}

  async publishTemplate(
    orgId: string,
    requestedBy: string,
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
    const pipelineTemplate = await this.pipelineTemplateRepository.getById(pipelineTemplateId)
    if (!pipelineTemplate) {
      throw new NotFoundException('Pipeline template not found')
    }
    if (!pipelineTemplate.isPublic && pipelineTemplate.createdBy !== requestedBy) {
      throw new NotFoundException('Pipeline template not found')
    }

    const published = await this.marketplaceTemplateRepository.upsertPublishedTemplate(
      new Types.ObjectId(orgId),
      new Types.ObjectId(pipelineTemplateId),
      {
        title: data.title?.trim() || pipelineTemplate.name,
        description: data.description || '',
        thumbnailUrl: data.thumbnailUrl || '',
        tags: this.normalizeTags(data.tags),
        price: Math.max(data.price || 0, 0),
        currency: data.currency || MarketplaceCurrency.CNY,
        isApproved: false,
      },
    )

    return this.toResponse(published, true)
  }

  async listTemplates(
    filters: MarketplaceFilters,
    sort: string | undefined,
    pagination: PaginationInput,
    requesterOrgId?: string,
  ) {
    const page = Math.max(Number(pagination.page || 1), 1)
    const limit = Math.min(Math.max(Number(pagination.limit || 20), 1), 100)
    const query = this.buildListQuery(filters, requesterOrgId)
    const sortOption = this.resolveSort(sort)

    const [items, total] = await this.marketplaceTemplateRepository.listByQuery(query, sortOption, page, limit)

    return {
      items: items.map(item => this.toResponse(item)),
      total,
      page,
      limit,
    }
  }

  async getTemplate(id: string, requesterOrgId?: string) {
    const template = await this.marketplaceTemplateRepository.getById(id)
    if (!template) {
      throw new NotFoundException('Marketplace template not found')
    }
    if (!template.isApproved && template.authorOrgId.toString() !== requesterOrgId) {
      throw new NotFoundException('Marketplace template not found')
    }

    return this.toResponse(template, true)
  }

  async purchaseTemplate(orgId: string, templateId: string) {
    const template = await this.marketplaceTemplateRepository.getById(templateId)
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
      await this.marketplaceTemplateRepository.updateTemplate(templateId, {
        $inc: { downloads: 1 },
        $push: {
          purchaseHistory: {
            orgId: new Types.ObjectId(orgId),
            purchasedAt: new Date(),
          },
        },
      })
    }

    const latest = await this.marketplaceTemplateRepository.getById(templateId)
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

    const template = await this.marketplaceTemplateRepository.getById(templateId)
    if (!template) {
      throw new NotFoundException('Marketplace template not found')
    }

    const reviews: MarketplaceReviewSnapshot[] = (template.reviews || []).map(item => ({
      orgId: item.orgId.toString(),
      rating: item.rating,
      review: item.review,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
    const existingIndex = reviews.findIndex(item => item.orgId === orgId)
    const nextReview: MarketplaceReviewSnapshot = {
      orgId,
      rating,
      review: review?.trim() || '',
      createdAt: existingIndex >= 0 ? reviews[existingIndex].createdAt : new Date(),
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
      ? Number((reviews.reduce((sum, item) => sum + item.rating, 0) / reviewCount).toFixed(2))
      : 0

    const updated = await this.marketplaceTemplateRepository.updateTemplate(
      templateId,
      {
        reviews: reviews.map(item => ({
          ...item,
          orgId: new Types.ObjectId(item.orgId),
        })),
        rating: averageRating,
        reviewCount,
      },
    )

    return this.toResponse(updated, true)
  }

  async featureTemplate(id: string) {
    const updated = await this.marketplaceTemplateRepository.updateTemplate(
      id,
      {
        isFeatured: true,
        isApproved: true,
      },
    )

    if (!updated) {
      throw new NotFoundException('Marketplace template not found')
    }

    return this.toResponse(updated, true)
  }

  private buildListQuery(filters: MarketplaceFilters, requesterOrgId?: string): FilterQuery<MarketplaceTemplate> {
    const query: Record<string, unknown> = {
      isApproved: filters.isApproved ?? true,
    }

    if (filters.isApproved === false) {
      if (!requesterOrgId || !Types.ObjectId.isValid(requesterOrgId)) {
        throw new BadRequestException('authorOrgId is required when querying unapproved templates')
      }

      query['authorOrgId'] = new Types.ObjectId(requesterOrgId)
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

    return query as FilterQuery<MarketplaceTemplate>
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

  private toResponse(template: LeanDoc<MarketplaceTemplate> | null, includeDetails = false) {
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
