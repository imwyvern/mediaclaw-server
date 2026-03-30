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
    const query: Record<string, any> = {
      orgId: new Types.ObjectId(orgId),
    }

    if (status) {
      query['status'] = status
    }

    return this.campaignModel.find(query).sort({ createdAt: -1 }).exec()
  }

  async findById(id: string) {
    const campaign = await this.campaignModel.findById(id).exec()
    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    return campaign
  }

  async update(id: string, data: Partial<Campaign>) {
    const campaign = await this.campaignModel.findByIdAndUpdate(
      id,
      this.normalizePayload(data),
      { new: true },
    ).exec()

    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    return campaign
  }

  async delete(id: string) {
    const campaign = await this.campaignModel.findByIdAndDelete(id).exec()
    if (!campaign) {
      throw new NotFoundException('Campaign not found')
    }

    return {
      id,
      deleted: true,
    }
  }

  async start(id: string) {
    return this.updateStatus(id, CampaignStatus.ACTIVE, {
      startDate: new Date(),
    })
  }

  async pause(id: string) {
    return this.updateStatus(id, CampaignStatus.PAUSED)
  }

  async complete(id: string) {
    return this.updateStatus(id, CampaignStatus.COMPLETED, {
      endDate: new Date(),
    })
  }

  private async updateStatus(id: string, status: CampaignStatus, extra: Partial<Campaign> = {}) {
    const campaign = await this.campaignModel.findByIdAndUpdate(
      id,
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

  private normalizePayload(data: Partial<Campaign>) {
    const payload: Record<string, any> = { ...data }

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
