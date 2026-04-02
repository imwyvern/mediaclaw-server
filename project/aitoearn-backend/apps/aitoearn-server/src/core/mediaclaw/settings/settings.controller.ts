import { Body, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { OrgApiKeyProvider } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { ByokService } from './byok.service'

@MediaClawApiController('api/v1/settings/api-keys')
export class SettingsController {
  constructor(private readonly byokService: ByokService) {}

  @Post()
  async addKey(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: {
      provider: OrgApiKeyProvider
      apiKey: string
      validateNow?: boolean
    },
  ) {
    return this.byokService.addKey(user.orgId || user.id, body)
  }

  @Get()
  async listKeys(
    @GetToken() user: { id: string, orgId?: string | null },
    @Query('provider') provider?: OrgApiKeyProvider,
  ) {
    return this.byokService.getKeyStatus(user.orgId || user.id, provider)
  }

  @Delete(':provider')
  async removeKey(
    @GetToken() user: { id: string, orgId?: string | null },
    @Param('provider') provider: OrgApiKeyProvider,
  ) {
    return this.byokService.removeKey(user.orgId || user.id, provider)
  }

  @Post(':provider/validate')
  async validateKey(
    @GetToken() user: { id: string, orgId?: string | null },
    @Param('provider') provider: OrgApiKeyProvider,
  ) {
    return this.byokService.validateKey(user.orgId || user.id, provider)
  }
}
