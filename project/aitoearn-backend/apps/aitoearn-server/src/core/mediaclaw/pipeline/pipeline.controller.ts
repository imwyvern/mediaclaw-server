import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { Pipeline } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { PipelineService } from './pipeline.service'

@MediaClawApiController('api/v1/pipeline')
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Post()
  async create(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: Partial<Pipeline> & { brandId: string },
  ) {
    return this.pipelineService.create(user.orgId || user.id, body.brandId, body)
  }

  @Get()
  async list(@GetToken() user: MediaClawAuthUser) {
    return this.pipelineService.findByOrg(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.pipelineService.findById(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: Partial<Pipeline>,
  ) {
    return this.pipelineService.update(user.orgId || user.id, id, body)
  }

  @Patch(':id/preferences')
  async updatePreferences(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: Partial<Pipeline['preferences']>,
  ) {
    return this.pipelineService.updatePreferences(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async archive(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.pipelineService.archive(user.orgId || user.id, id)
  }
}
