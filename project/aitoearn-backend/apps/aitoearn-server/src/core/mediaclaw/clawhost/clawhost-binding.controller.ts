import { Body, Post } from '@nestjs/common'
import { Internal, Public } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import {
  ConnectClawHostInstanceDto,
  ProvisionClawHostInstanceDto,
} from './clawhost.dto'
import { ClawHostService } from './clawhost.service'

@MediaClawApiController('api/v1')
export class ClawHostBindingController {
  constructor(private readonly clawHostService: ClawHostService) {}

  @Internal()
  @Post('provision')
  async provision(@Body() body: ProvisionClawHostInstanceDto) {
    return this.clawHostService.provisionInstance(body)
  }

  @Public()
  @Post('connect')
  async connect(@Body() body: ConnectClawHostInstanceDto) {
    return this.clawHostService.connectInstance(body)
  }
}
