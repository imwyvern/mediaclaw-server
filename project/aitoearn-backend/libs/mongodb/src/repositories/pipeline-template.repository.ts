import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { PipelineTemplate } from '../schemas'
import { BaseRepository } from './base.repository'

export class PipelineTemplateRepository extends BaseRepository<PipelineTemplate> {
  constructor(
    @InjectModel(PipelineTemplate.name) pipelineTemplateModel: Model<PipelineTemplate>,
  ) {
    super(pipelineTemplateModel)
  }
}
