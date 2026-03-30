import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { PipelineService } from './pipeline.service'

@Controller('api/v1/pipeline')
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
  async findOne(@Param('id') id: string) {
    return this.pipelineService.findById(id)
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.pipelineService.update(id, body)
  }

  @Patch(':id/preferences')
  async updatePreferences(@Param('id') id: string, @Body() body: any) {
    return this.pipelineService.updatePreferences(id, body)
  }

  @Delete(':id')
  async archive(@Param('id') id: string) {
    return this.pipelineService.archive(id)
  }
}
