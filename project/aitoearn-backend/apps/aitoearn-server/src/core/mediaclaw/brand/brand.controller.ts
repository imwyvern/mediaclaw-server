import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { BrandService } from './brand.service'

@MediaClawApiController('api/v1/brand')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  async create(@GetToken() user: any, @Body() body: any) {
    return this.brandService.create(user.orgId || user.id, body)
  }

  @Get()
  async list(@GetToken() user: any) {
    return this.brandService.findByOrg(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@GetToken() user: any, @Param('id') id: string) {
    return this.brandService.findById(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(@GetToken() user: any, @Param('id') id: string, @Body() body: any) {
    return this.brandService.update(user.orgId || user.id, id, body)
  }

  @Patch(':id/assets')
  async updateAssets(@GetToken() user: any, @Param('id') id: string, @Body() body: any) {
    return this.brandService.updateAssets(user.orgId || user.id, id, body)
  }

  @Patch(':id/video-style')
  async updateVideoStyle(@GetToken() user: any, @Param('id') id: string, @Body() body: any) {
    return this.brandService.updateVideoStyle(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async remove(@GetToken() user: any, @Param('id') id: string) {
    return this.brandService.delete(user.orgId || user.id, id)
  }
}
