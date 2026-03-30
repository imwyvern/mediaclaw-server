import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Pipeline, PipelineStatus } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name)

  constructor(
    @InjectModel(Pipeline.name) private readonly pipelineModel: Model<Pipeline>,
  ) {}

  async create(orgId: string, brandId: string, data: Partial<Pipeline>) {
    return this.pipelineModel.create({
      ...data,
      orgId: new Types.ObjectId(orgId),
      brandId: new Types.ObjectId(brandId),
      status: PipelineStatus.ACTIVE,
    })
  }

  async findByOrg(orgId: string) {
    return this.pipelineModel.find({
      orgId: new Types.ObjectId(orgId),
      status: { $ne: PipelineStatus.ARCHIVED },
    }).exec()
  }

  async findById(orgId: string, id: string) {
    const pipeline = await this.findOwnedPipeline(orgId, id)
    if (!pipeline)
      throw new NotFoundException('Pipeline not found')
    return pipeline
  }

  async update(orgId: string, id: string, data: Partial<Pipeline>) {
    await this.findOwnedPipeline(orgId, id)
    return this.pipelineModel.findOneAndUpdate(this.buildOwnedQuery(orgId, id), data, { new: true }).exec()
  }

  async archive(orgId: string, id: string) {
    await this.findOwnedPipeline(orgId, id)
    return this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      { status: PipelineStatus.ARCHIVED },
      { new: true },
    ).exec()
  }

  async updatePreferences(orgId: string, id: string, preferences: Partial<Pipeline['preferences']>) {
    await this.findOwnedPipeline(orgId, id)
    return this.pipelineModel.findOneAndUpdate(
      this.buildOwnedQuery(orgId, id),
      { $set: { preferences } },
      { new: true },
    ).exec()
  }

  async incrementVideoCount(id: string, field: 'totalVideosProduced' | 'totalVideosPublished') {
    return this.pipelineModel.findByIdAndUpdate(
      id,
      { $inc: { [field]: 1 } },
      { new: true },
    ).exec()
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
      status: { $ne: PipelineStatus.ARCHIVED },
    }
  }

  private async findOwnedPipeline(orgId: string, id: string) {
    return this.pipelineModel.findOne(this.buildOwnedQuery(orgId, id)).exec()
  }
}
