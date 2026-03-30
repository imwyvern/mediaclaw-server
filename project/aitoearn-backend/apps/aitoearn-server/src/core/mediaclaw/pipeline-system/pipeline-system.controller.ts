import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { PipelineType } from '@yikart/mongodb'
import { PipelineSystemService } from './pipeline-system.service'

@Controller('api/v1/pipelines')
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
  async getTemplate(@Param('id') id: string) {
    return this.pipelineSystemService.getTemplate(id)
  }

  @Post(':id/apply')
  async applyTemplate(
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
    return this.pipelineSystemService.applyTemplate(id, body.brandId, body.overrides)
  }

  @Post(':id/learn')
  async learnPreference(
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
    return this.pipelineSystemService.learnPreference(id, body)
  }

  @Post(':id/warm-up')
  async warmUp(
    @Param('id') id: string,
    @GetToken() user: any,
  ) {
    return this.pipelineSystemService.warmUp(id, user.id)
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
