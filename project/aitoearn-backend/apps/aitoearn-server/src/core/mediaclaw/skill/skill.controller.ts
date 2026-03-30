import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { MediaClawApiKeyGuard } from '../apikey/apikey.guard'
import { SkillService } from './skill.service'

@Public()
@UseGuards(MediaClawApiKeyGuard)
@Controller('api/v1/skill')
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Post('register')
  async register(
    @GetToken() user: any,
    @Body() body: { agentId: string, capabilities?: string[] },
  ) {
    return this.skillService.registerAgent(body.agentId, body.capabilities || [], {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }

  @Get('config')
  async getConfig(@GetToken() user: any, @Query('agentId') agentId: string) {
    return this.skillService.getAgentConfig(agentId, {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }

  @Post('feedback')
  async submitFeedback(
    @GetToken() user: any,
    @Body() body: { agentId: string, taskId: string, feedback: Record<string, any> },
  ) {
    return this.skillService.submitFeedback(body.agentId, body.taskId, body.feedback, {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }

  @Get('deliveries')
  async getDeliveries(@GetToken() user: any, @Query('agentId') agentId: string) {
    return this.skillService.getPendingDeliveries(agentId, {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }

  @Post('confirm-delivery')
  async confirmDelivery(
    @GetToken() user: any,
    @Body() body: { agentId: string, taskId: string },
  ) {
    return this.skillService.confirmDelivery(body.agentId, body.taskId, {
      orgId: user.orgId || user.id,
      userId: user.id,
    })
  }
}
