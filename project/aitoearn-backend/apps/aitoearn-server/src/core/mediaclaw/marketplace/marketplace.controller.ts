import { Body, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MarketplaceCurrency } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MarketplaceService } from './marketplace.service'

@MediaClawApiController('api/v1/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Post('publish')
  async publish(
    @GetToken() user: any,
    @Body() body: {
      pipelineTemplateId: string
      title?: string
      description?: string
      thumbnailUrl?: string
      tags?: string[]
      price?: number
      currency?: MarketplaceCurrency
    },
  ) {
    return this.marketplaceService.publishTemplate(
      user.orgId || user.id,
      body.pipelineTemplateId,
      body,
    )
  }

  @Post('purchase')
  async purchase(
    @GetToken() user: any,
    @Body() body: { templateId: string },
  ) {
    return this.marketplaceService.purchaseTemplate(user.orgId || user.id, body.templateId)
  }

  @Post('rate')
  async rate(
    @GetToken() user: any,
    @Body() body: {
      templateId: string
      rating: number
      review?: string
    },
  ) {
    return this.marketplaceService.rateTemplate(
      user.orgId || user.id,
      body.templateId,
      body.rating,
      body.review || '',
    )
  }

  @Post('feature')
  async feature(@Body() body: { templateId: string }) {
    return this.marketplaceService.featureTemplate(body.templateId)
  }

  @Get()
  async list(
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
    )
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.marketplaceService.getTemplate(id)
  }
}
