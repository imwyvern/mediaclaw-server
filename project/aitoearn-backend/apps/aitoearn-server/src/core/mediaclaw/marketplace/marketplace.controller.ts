import { Body, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MarketplaceCurrency, UserRole } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { PermissionGuard, Roles } from '../permission.guard'
import { MarketplaceService } from './marketplace.service'

class PublishMarketplaceTemplateDto {
  @IsString()
  pipelineTemplateId: string

  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsString()
  thumbnailUrl?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number

  @IsOptional()
  @IsEnum(MarketplaceCurrency)
  currency?: MarketplaceCurrency
}

class TemplateIdDto {
  @IsString()
  templateId: string
}

class RateTemplateDto extends TemplateIdDto {
  @Type(() => Number)
  @IsNumber()
  rating: number

  @IsOptional()
  @IsString()
  review?: string
}

@MediaClawApiController('api/v1/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Post('publish')
  async publish(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: PublishMarketplaceTemplateDto,
  ) {
    return this.marketplaceService.publishTemplate(
      user.orgId || user.id,
      user.id,
      body.pipelineTemplateId,
      body,
    )
  }

  @Post('purchase')
  async purchase(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: TemplateIdDto,
  ) {
    return this.marketplaceService.purchaseTemplate(user.orgId || user.id, body.templateId)
  }

  @Post('rate')
  async rate(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: RateTemplateDto,
  ) {
    return this.marketplaceService.rateTemplate(
      user.orgId || user.id,
      body.templateId,
      body.rating,
      body.review || '',
    )
  }

  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(PermissionGuard)
  @Post('feature')
  async feature(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: TemplateIdDto,
  ) {
    return this.marketplaceService.featureTemplate(body.templateId)
  }

  @Get()
  async list(
    @GetToken() user: MediaClawAuthUser,
    @Query('search') search?: string,
    @Query('tag') tag?: string,
    @Query('isFeatured') isFeatured?: string,
    @Query('isApproved') isApproved?: string,
    @Query('authorOrgId') authorOrgId?: string,
    @Query('priceType') priceType?: 'free' | 'paid',
    @Query('sort') sort?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.marketplaceService.listTemplates(
      {
        search,
        tag,
        isFeatured: typeof isFeatured === 'string' ? isFeatured === 'true' : undefined,
        isApproved: typeof isApproved === 'string' ? isApproved === 'true' : undefined,
        authorOrgId,
        priceType,
      },
      sort,
      {
        page: Number(page),
        limit: Number(limit),
      },
      user.orgId || user.id,
    )
  }

  @Get(':id')
  async detail(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.marketplaceService.getTemplate(id, user.orgId || user.id)
  }
}
