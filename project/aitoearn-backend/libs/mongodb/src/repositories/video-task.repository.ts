import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { VideoTask } from '../schemas'
import { BaseRepository } from './base.repository'

@Injectable()
export class VideoTaskRepository extends BaseRepository<VideoTask> {
  constructor(
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
  ) {
    super(videoTaskModel)
  }
}
