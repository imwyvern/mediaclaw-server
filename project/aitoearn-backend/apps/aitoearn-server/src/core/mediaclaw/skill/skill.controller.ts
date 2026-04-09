import { Body, Get, Post, Query, UseGuards } from '@nestjs/common'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator'
import { MediaClawApiKeyGuard } from '../apikey/apikey.guard'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { SkillService } from './skill.service'

class RegisterSkillAgentDto {
  @IsString()
  agentId: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[]
}

class SubmitSkillFeedbackDto {
  @IsString()
  agentId: string

  @IsString()
  taskId: string

  @IsObject()
  feedback: Record<string, unknown>
}

class ConfirmSkillDeliveryDto {
  @IsString()
  agentId: string

  @ValidateIf(body => !body.taskId)
  @IsString()
  deliveryRecordId?: string

  @ValidateIf(body => !body.deliveryRecordId)
  @IsString()
  taskId?: string
}

@Public()
@UseGuards(MediaClawApiKeyGuard)
@MediaClawApiController('api/v1/skill')
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Post('register')
  async register(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: RegisterSkillAgentDto,
  ) {
    return this.skillService.registerAgent(body.agentId, body.capabilities || [], {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }

  @Get('config')
  async getConfig(@GetToken() user: MediaClawAuthUser, @Query('agentId') agentId: string) {
    return this.skillService.getAgentConfig(agentId, {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }

  @Get('capabilities')
  async discoverCapabilities(@GetToken() user: MediaClawAuthUser, @Query('agentId') agentId: string) {
    return this.skillService.discoverCapabilities(agentId, {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }

  @Post('feedback')
  async submitFeedback(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: SubmitSkillFeedbackDto,
  ) {
    return this.skillService.submitFeedback(body.agentId, body.taskId, body.feedback, {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }

  @Get('deliveries')
  async getDeliveries(@GetToken() user: MediaClawAuthUser, @Query('agentId') agentId: string) {
    return this.skillService.getPendingDeliveries(agentId, {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }

  @Post('confirm-delivery')
  async confirmDelivery(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: ConfirmSkillDeliveryDto,
  ) {
    return this.skillService.confirmDelivery(body.agentId, {
      taskId: body.taskId,
      deliveryRecordId: body.deliveryRecordId,
    }, {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }
}
