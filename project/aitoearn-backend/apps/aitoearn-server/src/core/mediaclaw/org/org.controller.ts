import { Body, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { OrgService } from './org.service'

@MediaClawApiController('api/v1/org')
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  @Post()
  async create(@Body() body: any) {
    return this.orgService.create(body)
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.orgService.findById(id)
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.orgService.update(id, body)
  }
}
