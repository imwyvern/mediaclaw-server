import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { MediaClawApiKeyService } from './apikey.service'

@Injectable()
export class MediaClawApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyService: MediaClawApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()

    if (request['user']) {
      return true
    }

    const [type, token] = request.headers.authorization?.split(' ') ?? []
    if (type !== 'Bearer' || !token?.startsWith('mc_live_')) {
      throw new UnauthorizedException('Missing MediaClaw API key')
    }

    request['user'] = await this.apiKeyService.validate(token)
    return true
  }
}
