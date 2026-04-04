import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { Brand } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { BrandService } from './brand.service'

@MediaClawApiController('api/v1/brand')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  async create(@GetToken() user: MediaClawAuthUser, @Body() body: Partial<Brand>) {
    return this.brandService.create(user.orgId || user.id, body)
  }

  @Get()
  async list(@GetToken() user: MediaClawAuthUser) {
    return this.brandService.findByOrg(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.brandService.findById(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(@GetToken() user: MediaClawAuthUser, @Param('id') id: string, @Body() body: Partial<Brand>) {
    return this.brandService.update(user.orgId || user.id, id, body)
  }

  @Patch(':id/assets')
  async updateAssets(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: { logoUrl?: string, referenceImages?: string[] },
  ) {
    return this.brandService.updateAssets(user.orgId || user.id, id, body)
  }

  @Patch(':id/video-style')
  async updateVideoStyle(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: {
      preferredDuration?: number
      aspectRatio?: string
      subtitleStyle?: Record<string, unknown>
    },
  ) {
    return this.brandService.updateVideoStyle(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async remove(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.brandService.delete(user.orgId || user.id, id)
  }
}
