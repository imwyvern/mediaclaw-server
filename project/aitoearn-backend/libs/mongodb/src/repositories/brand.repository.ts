import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Brand } from '../schemas'
import { BaseRepository } from './base.repository'

@Injectable()
export class BrandRepository extends BaseRepository<Brand> {
  constructor(
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
  ) {
    super(brandModel)
  }

  async getActiveById(id: string) {
    return this.findOne({ _id: id, isActive: true })
  }
}
