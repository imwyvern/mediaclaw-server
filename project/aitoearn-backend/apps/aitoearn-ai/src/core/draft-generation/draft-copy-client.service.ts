import { Injectable } from '@nestjs/common'
import { AppException, CommonResponse, ResponseCode } from '@yikart/common'
import { config } from '../../config'

export type DraftCopyProvider = 'deepseek' | 'gemini'

export interface DraftCopyVariant {
  copyHistoryId: string | null
  variantIndex: number
  title: string
  subtitle: string
  description: string
  hashtags: string[]
  blueWords: string[]
  commentGuide: string
  commentGuides: string[]
}

interface DraftCopyResponse {
  videoTaskId: string | null
  brandId: string | null
  count: number
  primaryCopy: DraftCopyVariant | null
  copies: DraftCopyVariant[]
}

export interface GenerateDraftCopyInput {
  userId: string
  theme?: string
  platform?: string
  style?: string
  videoUrl?: string
  sourceHint?: string
  provider?: DraftCopyProvider
}

@Injectable()
export class DraftCopyClientService {
  async generateCopy(input: GenerateDraftCopyInput): Promise<DraftCopyVariant> {
    const response = await fetch(`${config.serverClient.baseUrl}/internal/mediaclaw/copy/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.serverClient.token}`,
      },
      body: JSON.stringify({
        userId: input.userId,
        theme: input.theme,
        platform: input.platform,
        style: input.style,
        videoUrl: input.videoUrl,
        sourceHint: input.sourceHint,
        provider: input.provider,
        count: 1,
      }),
    })

    if (!response.ok) {
      throw new AppException(ResponseCode.AiCallFailed, {
        status: response.status,
        statusText: response.statusText,
      })
    }

    const payload = await response.json() as CommonResponse<DraftCopyResponse>
    if (payload.code !== 0 || !payload.data?.primaryCopy) {
      throw new AppException(payload.code || ResponseCode.AiCallFailed, {
        message: payload.message,
      })
    }

    return payload.data.primaryCopy
  }
}
