import {
  Body,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { PipelineType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PipelineSystemService } from './pipeline-system.service'

@MediaClawApiController('api/v1/pipelines')
export class PipelineSystemController {
  constructor(private readonly pipelineSystemService: PipelineSystemService) {}

  @Post()
  async createTemplate(
    @GetToken() user: any,
    @Body() body: {
      name: string
      type: PipelineType
      steps?: Array<{
        name: string
        config?: Record<string, any>
        order?: number
      }>
      defaultParams?: {
        duration?: number
        aspectRatio?: string
        subtitleStyle?: Record<string, any>
        musicStyle?: string
      }
      isPublic?: boolean
    },
  ) {
    return this.pipelineSystemService.createTemplate({
      ...body,
      createdBy: user.id,
    })
  }

  @Get()
  async listTemplates(
    @GetToken() user: any,
    @Query('type') type?: PipelineType,
    @Query('isPublic') isPublic?: string,
  ) {
    return this.pipelineSystemService.listTemplates({
      type,
      isPublic: this.parseBooleanQuery(isPublic),
      requestedBy: user.id,
    })
  }

  @Get(':id')
  async getTemplate(@GetToken() user: any, @Param('id') id: string) {
    return this.pipelineSystemService.getTemplate(id, user.id)
  }

  @Post(':id/apply')
  async applyTemplate(
    @GetToken() user: any,
    @Param('id') id: string,
    @Body() body: {
      brandId: string
      overrides?: {
        name?: string
        description?: string
        duration?: number
        aspectRatio?: string
        subtitleStyle?: Record<string, any>
        musicStyle?: string
        preferredStyles?: string[]
        avoidStyles?: string[]
        schedule?: Record<string, any>
      }
    },
  ) {
    return this.pipelineSystemService.applyTemplate(
      id,
      user.id,
      user.orgId || user.id,
      body.brandId,
      body.overrides,
    )
  }

  @Post(':id/learn')
  async learnPreference(
    @GetToken() user: any,
    @Param('id') id: string,
    @Body() body: {
      source?: string
      preferredStyles?: string[]
      avoidStyles?: string[]
      subtitleStyle?: Record<string, any>
      score?: number
      notes?: string
    },
  ) {
    return this.pipelineSystemService.learnPreference(user.orgId || user.id, id, body)
  }

  @Post(':id/warm-up')
  async warmUp(
    @Param('id') id: string,
    @GetToken() user: any,
  ) {
    return this.pipelineSystemService.warmUp(user.orgId || user.id, id, user.id)
  }

  private parseBooleanQuery(value?: string) {
    if (typeof value !== 'string') {
      return undefined
    }

    if (value === 'true') {
      return true
    }
    if (value === 'false') {
      return false
    }

    return undefined
  }
}
