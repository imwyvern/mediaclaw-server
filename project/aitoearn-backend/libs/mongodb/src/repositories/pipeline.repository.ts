import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Pipeline } from '../schemas'
import { BaseRepository } from './base.repository'

@Injectable()
export class PipelineRepository extends BaseRepository<Pipeline> {
  constructor(
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
  ) {
    super(pipelineModel)
  }
}
