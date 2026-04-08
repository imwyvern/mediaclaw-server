import { Body, Controller, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Internal } from '@yikart/aitoearn-auth'
import { ApiDoc } from '@yikart/common'
import { InternalGenerateCopyDto } from '../mediaclaw/copy/copy.dto'
import { CopyService } from '../mediaclaw/copy/copy.service'

@ApiTags('Internal/MediaClaw-Copy')
@Controller('internal')
@Internal()
export class CopyInternalController {
  constructor(
    private readonly copyService: CopyService,
  ) {}

  @ApiDoc({
    summary: 'Generate MediaClaw copy payload for AI draft workflows',
  })
  @Post('mediaclaw/copy/generate')
  async generateCopy(
    @Body() body: InternalGenerateCopyDto,
  ) {
    return this.copyService.generateForInternal(body)
  }
}
