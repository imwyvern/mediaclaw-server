import { BadRequestException, Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { BrandService } from './brand.service'

class BrandAssetsDto {
  @IsOptional()
  @IsString()
  logoUrl?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  colors?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fonts?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  slogans?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prohibitedWords?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceImages?: string[]
}

class BrandVideoStyleDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  preferredDuration?: number

  @IsOptional()
  @IsString()
  aspectRatio?: string

  @IsOptional()
  @IsObject()
  subtitleStyle?: Record<string, unknown>

  @IsOptional()
  @IsString()
  referenceVideoUrl?: string
}

class UpsertBrandDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  industry?: string

  @IsOptional()
  @IsString()
  category?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => BrandAssetsDto)
  assets?: BrandAssetsDto

  @IsOptional()
  @ValidateNested()
  @Type(() => BrandVideoStyleDto)
  videoStyle?: BrandVideoStyleDto

  @IsOptional()
  @IsString()
  logoUrl?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean
}

class UpdatePrimaryBrandDto extends UpsertBrandDto {
  @IsOptional()
  @IsString()
  id?: string

  @IsOptional()
  @IsString()
  brandId?: string
}

class UpdateBrandAssetsDto {
  @IsOptional()
  @IsString()
  brandId?: string

  @IsOptional()
  @IsString()
  logoUrl?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceImages?: string[]
}

@MediaClawApiController('api/v1/brand')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  async create(@GetToken() user: MediaClawAuthUser, @Body() body: UpsertBrandDto) {
    return this.brandService.create(user.orgId || user.id, this.toBrandPayload(body))
  }

  @Get()
  async list(@GetToken() user: MediaClawAuthUser) {
    return this.brandService.findByOrg(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.brandService.findById(user.orgId || user.id, id)
  }

  @Patch()
  async updatePrimaryBrand(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: UpdatePrimaryBrandDto,
  ) {
    const brandId = body.id || body.brandId
    if (!brandId) {
      throw new BadRequestException('brandId is required')
    }

    return this.brandService.update(user.orgId || user.id, brandId, this.toBrandPayload(body))
  }

  @Patch(':id')
  async update(@GetToken() user: MediaClawAuthUser, @Param('id') id: string, @Body() body: UpsertBrandDto) {
    return this.brandService.update(user.orgId || user.id, id, this.toBrandPayload(body))
  }

  @Post('assets')
  async createAssets(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: UpdateBrandAssetsDto,
  ) {
    if (!body.brandId) {
      throw new BadRequestException('brandId is required')
    }

    return this.brandService.updateAssets(user.orgId || user.id, body.brandId, body)
  }

  @Patch(':id/assets')
  async updateAssets(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: UpdateBrandAssetsDto,
  ) {
    return this.brandService.updateAssets(user.orgId || user.id, id, body)
  }

  @Patch(':id/video-style')
  async updateVideoStyle(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: BrandVideoStyleDto,
  ) {
    return this.brandService.updateVideoStyle(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async remove(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.brandService.delete(user.orgId || user.id, id)
  }

  private toBrandPayload(body: UpsertBrandDto | UpdatePrimaryBrandDto) {
    return {
      ...body,
      ...(body.assets ? { assets: { ...body.assets } } : {}),
      ...(body.videoStyle ? { videoStyle: { ...body.videoStyle } } : {}),
    } as any
  }
}
