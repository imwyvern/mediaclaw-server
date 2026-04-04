import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Campaign, CampaignStatus, VideoTask } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

@Injectable()
export class CampaignService {
  constructor(
    @InjectModel(Campaign.name) private readonly campaignModel: Model<Campaign>,
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
  ) {}

  async create(orgId: string, data: Partial<Campaign>) {
    return this.campaignModel.create({
      ...this.normalizePayload(data),
      orgId: new Types.ObjectId(orgId),
      status: data.status || CampaignStatus.DRAFT,
    })
  }

  async findByOrg(orgId: string, status?: CampaignStatus) {
    const query: Record<string, unknown> = {
      orgId: new Types.ObjectId(orgId),
    }

    if (status) {
      query['status'] = status
    }

    return this.campaignModel.find(query).sort({ createdAt: -1 }).exec()
  }

  async findById(orgId: string, id: string) {
    const campaign = await this.findOwnedCampaign(orgId, id)
    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    return campaign
  }

  async listVideos(orgId: string, id: string) {
    const campaign = await this.findById(orgId, id)
    const matchers: Array<Record<string, unknown>> = [
      { campaignId: campaign._id },
    ]

    if (campaign.brandId) {
      const brandScope: Record<string, unknown> = {
        brandId: campaign.brandId,
      }

      if (campaign.startDate || campaign.endDate) {
        const createdAtRange: Record<string, Date> = {}
        if (campaign.startDate) {
          createdAtRange['$gte'] = campaign.startDate
        }
        if (campaign.endDate) {
          createdAtRange['$lte'] = campaign.endDate
        }
        brandScope['createdAt'] = createdAtRange
      }

      matchers.push(brandScope)
    }

    if (campaign.name) {
      matchers.push({
        'metadata.campaign': campaign.name,
      })
    }

    const tasks = await this.videoTaskModel.find({
      orgId: new Types.ObjectId(orgId),
      'metadata.isDeleted': { $ne: true },
      $or: matchers,
    })
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    return tasks.map(task => ({
      id: task._id.toString(),
      taskId: task._id.toString(),
      campaignId: campaign._id.toString(),
      brandId: task.brandId?.toString() || null,
      pipelineId: task.pipelineId?.toString() || null,
      status: task.status,
      taskType: task.taskType,
      sourceVideoUrl: task.sourceVideoUrl || '',
      outputVideoUrl: task.outputVideoUrl || '',
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    }))
  }

  async update(orgId: string, id: string, data: Partial<Campaign>) {
    await this.findOwnedCampaign(orgId, id)
    const campaign = await this.campaignModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      this.normalizePayload(data),
      { new: true },
    ).exec()

    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    return campaign
  }

  async delete(orgId: string, id: string) {
    const campaign = await this.campaignModel.findOneAndDelete(this.buildOwnedQuery(orgId, id)).exec()
    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    return {
      id,
      deleted: true,
    }
  }

  async start(orgId: string, id: string) {
    return this.updateStatus(orgId, id, CampaignStatus.ACTIVE, {
      startDate: new Date(),
    })
  }

  async pause(orgId: string, id: string) {
    return this.updateStatus(orgId, id, CampaignStatus.PAUSED)
  }

  async complete(orgId: string, id: string) {
    return this.updateStatus(orgId, id, CampaignStatus.COMPLETED, {
      endDate: new Date(),
    })
  }

  private async updateStatus(orgId: string, id: string, status: CampaignStatus, extra: Partial<Campaign> = {}) {
    const campaign = await this.campaignModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      {
        status,
        ...this.normalizePayload(extra),
      },
      { new: true },
    ).exec()

    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    return campaign
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
    }
  }

  private async findOwnedCampaign(orgId: string, id: string) {
    return this.campaignModel.findOne(this.buildOwnedQuery(orgId, id)).exec()
  }

  private normalizePayload(data: Partial<Campaign>) {
    const payload: Record<string, unknown> = { ...data }

    if ('brandId' in payload) {
      payload['brandId'] = this.toObjectId(payload['brandId'] as string | null | undefined)
    }

    if ('pipelineId' in payload) {
      payload['pipelineId'] = this.toObjectId(payload['pipelineId'] as string | null | undefined)
    }

    if ('platforms' in payload) {
      payload['targetPlatforms'] = this.normalizeStringList(payload['platforms'])
      delete payload['platforms']
    }

    if ('totalVideos' in payload) {
      payload['totalPlanned'] = this.toNumber(payload['totalVideos'])
      delete payload['totalVideos']
    }

    if ('objective' in payload && typeof payload['objective'] !== 'string') {
      delete payload['objective']
    }

    if ('description' in payload && typeof payload['description'] !== 'string') {
      delete payload['description']
    }

    return payload
  }

  private toObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
  }

  private normalizeStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
  }

  private toNumber(value: unknown) {
    const normalized = Number(value)
    return Number.isFinite(normalized) && normalized >= 0
      ? normalized
      : 0
  }
}
