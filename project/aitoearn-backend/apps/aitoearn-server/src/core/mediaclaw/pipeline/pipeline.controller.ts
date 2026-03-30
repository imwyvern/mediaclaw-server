import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PipelineService } from './pipeline.service'

@MediaClawApiController('api/v1/pipeline')
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Post()
  async create(@GetToken() user: any, @Body() body: any) {
    return this.pipelineService.create(user.orgId || user.id, body.brandId, body)
  }

  @Get()
  async list(@GetToken() user: any) {
    return this.pipelineService.findByOrg(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@GetToken() user: any, @Param('id') id: string) {
    return this.pipelineService.findById(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(@GetToken() user: any, @Param('id') id: string, @Body() body: any) {
    return this.pipelineService.update(user.orgId || user.id, id, body)
  }

  @Patch(':id/preferences')
  async updatePreferences(@GetToken() user: any, @Param('id') id: string, @Body() body: any) {
    return this.pipelineService.updatePreferences(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async archive(@GetToken() user: any, @Param('id') id: string) {
    return this.pipelineService.archive(user.orgId || user.id, id)
  }
}
