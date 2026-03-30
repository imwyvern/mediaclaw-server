import { Injectable } from '@nestjs/common'
import { CopyEngineService, GeneratedCopy } from './copy-engine.service'

@Injectable()
export class CopyService {
  constructor(private readonly copyEngineService: CopyEngineService) {}

  async generateCopy(
    brandId: string | null | undefined,
    videoUrl: string,
    metadata: Record<string, any> = {},
  ): Promise<GeneratedCopy> {
    return this.copyEngineService.generateCopy(brandId, videoUrl, metadata)
  }
}

export type { GeneratedCopy }
