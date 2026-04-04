import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Campaign, CampaignStatus } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

@Injectable()
export class CampaignService {
  constructor(
    @InjectModel(Campaign.name) private readonly campaignModel: Model<Campaign>,
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

    return payload
  }

  private toObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
  }
}
