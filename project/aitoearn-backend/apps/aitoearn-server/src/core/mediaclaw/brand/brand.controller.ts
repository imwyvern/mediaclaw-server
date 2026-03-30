import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { BrandService } from './brand.service'

@Controller('api/v1/brand')
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
  async findOne(@Param('id') id: string) {
    return this.brandService.findById(id)
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.brandService.update(id, body)
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.brandService.delete(id)
  }
}
