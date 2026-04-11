import type { LeanDoc } from '@yikart/mongodb'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  LayerBillingModel,
  LayerBillingPolicy,
  LayerPermissionPolicy,
  LayerQuotaPolicy,

  SkillMarketplaceEntry,
  SkillMarketplaceEntryRepository,
  SkillMarketplaceEntryStatus,
  SkillMarketplaceVisibility,
} from '@yikart/mongodb'
import { FilterQuery, SortOrder, Types } from 'mongoose'
import { ClawHostService } from '../clawhost/clawhost.service'
import {
  normalizeLayerBillingPolicy,
  normalizeLayerPermissionPolicy,
  normalizeLayerQuotaPolicy,
  normalizeStringList,
} from '../shared/layer-policy.utils'

interface SkillMarketplaceFilters {
  search?: string
  category?: string
  tag?: string
  capability?: string
  status?: SkillMarketplaceEntryStatus
  visibility?: SkillMarketplaceVisibility
}

interface PaginationInput {
  page?: number
  limit?: number
}

interface SkillMarketplaceRegisterInput {
  skillId: string
  version?: string
  name: string
  summary?: string
  description?: string
  category?: string
  tags?: string[]
  iconUrl?: string
  status?: SkillMarketplaceEntryStatus
  visibility?: SkillMarketplaceVisibility
  capabilityDeclaration?: {
    capabilities?: string[]
    schema?: Record<string, unknown>
  }
  compatibility?: {
    runtimeKinds?: string[]
    deploymentModes?: string[]
    minPlan?: string
  }
  skillLayer?: {
    quotaPolicy?: Partial<LayerQuotaPolicy>
    billingPolicy?: Partial<LayerBillingPolicy>
    permissionPolicy?: Partial<LayerPermissionPolicy>
  }
  isFeatured?: boolean
}

interface SkillMarketplaceReviewSnapshot {
  orgId: string
  rating: number
  review: string
  createdAt: Date
  updatedAt: Date
}

@Injectable()
export class SkillMarketplaceService {
  constructor(
    private readonly skillMarketplaceEntryRepository: SkillMarketplaceEntryRepository,
    private readonly clawHostService: ClawHostService,
  ) {}

  async registerSkill(orgId: string, input: SkillMarketplaceRegisterInput) {
    const ownerOrgId = this.toObjectId(orgId)
    const skillId = input.skillId.trim()
    const version = input.version?.trim() || 'latest'

    const entry = await this.skillMarketplaceEntryRepository.upsertByOwnerAndVersion(
      ownerOrgId,
      skillId,
      version,
      {
        name: input.name.trim(),
        summary: input.summary?.trim() || '',
        description: input.description?.trim() || '',
        category: input.category?.trim() || 'general',
        tags: normalizeStringList(input.tags),
        iconUrl: input.iconUrl?.trim() || '',
        status: input.status || SkillMarketplaceEntryStatus.DRAFT,
        visibility: input.visibility || SkillMarketplaceVisibility.PUBLIC,
        capabilityDeclaration: this.buildCapabilityDeclaration(input.capabilityDeclaration),
        compatibility: this.buildCompatibility(input.compatibility),
        skillLayer: this.buildSkillLayer(input.skillLayer),
        isFeatured: Boolean(input.isFeatured),
      },
    )

    return this.toResponse(entry, true)
  }

  async listSkills(
    requesterOrgId: string,
    filters: SkillMarketplaceFilters,
    sort: string | undefined,
    pagination: PaginationInput,
  ) {
    const page = this.normalizePage(pagination.page)
    const limit = this.normalizeLimit(pagination.limit)
    const query = this.buildListQuery(requesterOrgId, filters)

    const [items, total] = await this.skillMarketplaceEntryRepository.listByQuery(
      query,
      this.resolveSort(sort),
      page,
      limit,
    )

    return {
      items: items.map(item => this.toResponse(item)),
      total,
      page,
      limit,
    }
  }

  async installSkill(
    orgId: string,
    input: {
      instanceId: string
      skillId: string
      version?: string
    },
  ) {
    const entry = await this.resolveInstallableEntry(orgId, input.skillId, input.version)
    const installation = await this.clawHostService.installSkill(
      orgId,
      input.instanceId,
      entry.skillId,
      entry.version,
    )
    const ownerOrgId = this.toObjectId(orgId)
    const activeInstallExists = (entry.installHistory || []).some(
      item =>
        item.orgId.toString() === ownerOrgId.toString()
        && item.instanceId === input.instanceId
        && !item.uninstalledAt,
    )
    const installHistory = activeInstallExists
      ? entry.installHistory || []
      : [
          ...(entry.installHistory || []),
          {
            orgId: ownerOrgId,
            instanceId: input.instanceId.trim(),
            installedAt: new Date(),
            uninstalledAt: null,
          },
        ]

    const updated = await this.skillMarketplaceEntryRepository.updateEntry(
      entry._id.toString(),
      {
        $set: {
          installHistory,
        },
        ...(activeInstallExists ? {} : { $inc: { installs: 1 } }),
      },
    )

    return {
      instanceId: input.instanceId,
      skillId: entry.skillId,
      version: entry.version,
      installation,
      marketplaceEntry: this.toResponse(updated, true),
    }
  }

  async uninstallSkill(
    orgId: string,
    input: {
      instanceId: string
      skillId: string
      version?: string
    },
  ) {
    const removal = await this.clawHostService.uninstallSkill(
      orgId,
      input.instanceId,
      input.skillId,
    )
    const entry = await this.resolveEntryForRatingOrRemoval(orgId, input.skillId, input.version)
    if (!entry) {
      return {
        instanceId: input.instanceId,
        skillId: input.skillId,
        removal,
        marketplaceEntry: null,
      }
    }

    const ownerOrgId = this.toObjectId(orgId)
    const installHistory = (entry.installHistory || []).map((item) => {
      if (
        item.orgId.toString() === ownerOrgId.toString()
        && item.instanceId === input.instanceId
        && !item.uninstalledAt
      ) {
        return {
          ...item,
          uninstalledAt: new Date(),
        }
      }

      return item
    })
    const updated = await this.skillMarketplaceEntryRepository.updateEntry(
      entry._id.toString(),
      {
        $set: {
          installHistory,
        },
      },
    )

    return {
      instanceId: input.instanceId,
      skillId: input.skillId,
      removal,
      marketplaceEntry: updated ? this.toResponse(updated, true) : null,
    }
  }

  async rateSkill(
    orgId: string,
    input: {
      skillId: string
      version?: string
      rating: number
      review?: string
    },
  ) {
    const entry = await this.resolveEntryForRatingOrRemoval(orgId, input.skillId, input.version)
    if (!entry) {
      throw new NotFoundException('Skill marketplace entry not found')
    }

    const ownerOrgId = this.toObjectId(orgId)
    const reviews: SkillMarketplaceReviewSnapshot[] = (entry.reviews || []).map(item => ({
      orgId: item.orgId.toString(),
      rating: item.rating,
      review: item.review,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
    const existingIndex = reviews.findIndex(item => item.orgId === ownerOrgId.toString())
    const nextReview: SkillMarketplaceReviewSnapshot = {
      orgId: ownerOrgId.toString(),
      rating: input.rating,
      review: input.review?.trim() || '',
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
    const rating = reviewCount > 0
      ? Number((reviews.reduce((sum, item) => sum + item.rating, 0) / reviewCount).toFixed(2))
      : 0

    const updated = await this.skillMarketplaceEntryRepository.updateEntry(
      entry._id.toString(),
      {
        $set: {
          reviews: reviews.map(review => ({
            ...review,
            orgId: new Types.ObjectId(review.orgId),
          })),
          reviewCount,
          rating,
        },
      },
    )

    return this.toResponse(updated, true)
  }

  private buildListQuery(
    requesterOrgId: string,
    filters: SkillMarketplaceFilters,
  ): FilterQuery<SkillMarketplaceEntry> {
    const andConditions: Record<string, unknown>[] = []
    const requesterObjectId = Types.ObjectId.isValid(requesterOrgId)
      ? new Types.ObjectId(requesterOrgId)
      : null

    if (filters.search?.trim()) {
      andConditions.push({
        $or: [
          { name: new RegExp(filters.search.trim(), 'i') },
          { summary: new RegExp(filters.search.trim(), 'i') },
          { description: new RegExp(filters.search.trim(), 'i') },
          { skillId: new RegExp(filters.search.trim(), 'i') },
        ],
      })
    }

    if (filters.category?.trim()) {
      andConditions.push({ category: filters.category.trim() })
    }

    if (filters.tag?.trim()) {
      andConditions.push({ tags: filters.tag.trim() })
    }

    if (filters.capability?.trim()) {
      andConditions.push({
        'capabilityDeclaration.capabilities': filters.capability.trim(),
      })
    }

    if (filters.status && filters.status !== SkillMarketplaceEntryStatus.PUBLISHED) {
      if (!requesterObjectId) {
        throw new BadRequestException('Only organization owners can query non-published skills')
      }

      andConditions.push({ status: filters.status })
      andConditions.push({ ownerOrgId: requesterObjectId })
    }
    else {
      const accessConditions: Record<string, unknown>[] = [
        {
          status: SkillMarketplaceEntryStatus.PUBLISHED,
          visibility: SkillMarketplaceVisibility.PUBLIC,
        },
      ]

      if (requesterObjectId) {
        accessConditions.push({ ownerOrgId: requesterObjectId })
      }

      andConditions.push({ $or: accessConditions })
    }

    if (filters.visibility) {
      andConditions.push({ visibility: filters.visibility })
      if (filters.visibility !== SkillMarketplaceVisibility.PUBLIC) {
        if (!requesterObjectId) {
          throw new BadRequestException('Private or organization skills require organization context')
        }
        andConditions.push({ ownerOrgId: requesterObjectId })
      }
    }

    return andConditions.length > 0
      ? { $and: andConditions }
      : {}
  }

  private resolveSort(sort?: string) {
    const descending: SortOrder = -1

    switch (sort) {
      case 'rating':
        return [['rating', descending], ['reviewCount', descending], ['updatedAt', descending]] as [string, SortOrder][]
      case 'newest':
        return [['updatedAt', descending]] as [string, SortOrder][]
      case 'installs':
      default:
        return [['isFeatured', descending], ['installs', descending], ['updatedAt', descending]] as [string, SortOrder][]
    }
  }

  private async resolveInstallableEntry(orgId: string, skillId: string, version?: string) {
    const normalizedSkillId = skillId.trim()
    const normalizedVersion = version?.trim()
    const query = normalizedVersion
      ? {
          skillId: normalizedSkillId,
          version: normalizedVersion,
        }
      : {
          skillId: normalizedSkillId,
        }

    const entry = await this.skillMarketplaceEntryRepository.findLatest(query)
    if (!entry) {
      throw new NotFoundException('Skill marketplace entry not found')
    }

    const requesterOrgId = this.toObjectId(orgId).toString()
    const isOwner = entry.ownerOrgId.toString() === requesterOrgId
    const isPublished = entry.status === SkillMarketplaceEntryStatus.PUBLISHED
    const isPublic = entry.visibility === SkillMarketplaceVisibility.PUBLIC
    if (!isOwner && (!isPublished || !isPublic)) {
      throw new NotFoundException('Skill marketplace entry not found')
    }

    return entry
  }

  private async resolveEntryForRatingOrRemoval(orgId: string, skillId: string, version?: string) {
    const normalizedSkillId = skillId.trim()
    const normalizedVersion = version?.trim()
    const query = normalizedVersion
      ? { skillId: normalizedSkillId, version: normalizedVersion }
      : { skillId: normalizedSkillId }

    const entry = await this.skillMarketplaceEntryRepository.findLatest(query)
    if (!entry) {
      return null
    }

    const requesterOrgId = this.toObjectId(orgId).toString()
    const isOwner = entry.ownerOrgId.toString() === requesterOrgId
    const isPublished = entry.status === SkillMarketplaceEntryStatus.PUBLISHED
    if (!isOwner && !isPublished) {
      return null
    }

    return entry
  }

  private buildCapabilityDeclaration(input?: {
    capabilities?: string[]
    schema?: Record<string, unknown>
  }) {
    return {
      capabilities: normalizeStringList(input?.capabilities),
      schema: input?.schema && typeof input.schema === 'object'
        ? { ...input.schema }
        : {},
    }
  }

  private buildCompatibility(input?: {
    runtimeKinds?: string[]
    deploymentModes?: string[]
    minPlan?: string
  }) {
    return {
      runtimeKinds: normalizeStringList(input?.runtimeKinds),
      deploymentModes: normalizeStringList(input?.deploymentModes),
      minPlan: input?.minPlan?.trim() || '',
    }
  }

  private buildSkillLayer(input?: {
    quotaPolicy?: Partial<LayerQuotaPolicy>
    billingPolicy?: Partial<LayerBillingPolicy>
    permissionPolicy?: Partial<LayerPermissionPolicy>
  }) {
    return {
      quotaPolicy: normalizeLayerQuotaPolicy(input?.quotaPolicy),
      billingPolicy: normalizeLayerBillingPolicy(input?.billingPolicy, LayerBillingModel.USAGE),
      permissionPolicy: normalizeLayerPermissionPolicy(input?.permissionPolicy),
    }
  }

  private normalizePage(page?: number) {
    const normalized = Number(page || 1)
    return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : 1
  }

  private normalizeLimit(limit?: number) {
    const normalized = Number(limit || 20)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 20
    }

    return Math.min(Math.floor(normalized), 100)
  }

  private toObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('orgId is invalid')
    }

    return new Types.ObjectId(id)
  }

  private toResponse(entry: LeanDoc<SkillMarketplaceEntry> | null, includeDetails = false) {
    if (!entry) {
      throw new NotFoundException('Skill marketplace entry not found')
    }

    return {
      id: entry._id.toString(),
      ownerOrgId: entry.ownerOrgId.toString(),
      skillId: entry.skillId,
      version: entry.version,
      name: entry.name,
      summary: entry.summary,
      description: entry.description,
      category: entry.category,
      tags: entry.tags || [],
      iconUrl: entry.iconUrl,
      status: entry.status,
      visibility: entry.visibility,
      capabilityDeclaration: this.buildCapabilityDeclaration(entry.capabilityDeclaration),
      compatibility: this.buildCompatibility(entry.compatibility),
      skillLayer: this.buildSkillLayer(entry.skillLayer),
      installs: entry.installs || 0,
      activeInstallCount: (entry.installHistory || []).filter(item => !item.uninstalledAt).length,
      rating: entry.rating || 0,
      reviewCount: entry.reviewCount || 0,
      isFeatured: Boolean(entry.isFeatured),
      reviews: includeDetails
        ? (entry.reviews || []).map(review => ({
            orgId: review.orgId.toString(),
            rating: review.rating,
            review: review.review,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
          }))
        : undefined,
      installHistory: includeDetails
        ? (entry.installHistory || []).map(item => ({
            orgId: item.orgId.toString(),
            instanceId: item.instanceId,
            installedAt: item.installedAt,
            uninstalledAt: item.uninstalledAt,
          }))
        : undefined,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }
}
