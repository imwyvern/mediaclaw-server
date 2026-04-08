import { Injectable, Logger } from '@nestjs/common'

interface EmbeddingResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
  usage?: {
    prompt_tokens: number
    total_tokens: number
  }
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)
  private readonly defaultModel = 'doubao-embedding-vision'
  private readonly defaultBaseUrl = 'https://ark.cn-beijing.volces.com/api/v3'
  private readonly requestTimeoutMs = 15000

  async getEmbedding(imageUrlOrBase64: string): Promise<number[] | null> {
    const apiKey = this.getApiKey()
    if (!apiKey) {
      this.logger.warn('Embedding API key not configured, skipping vector embedding')
      return null
    }

    const model = process.env['DOUBAO_EMBEDDING_MODEL'] || this.defaultModel
    const baseUrl = (process.env['DOUBAO_EMBEDDING_BASE_URL'] || this.defaultBaseUrl).replace(/\/+$/, '')

    try {
      const isBase64 = imageUrlOrBase64.startsWith('data:') || !imageUrlOrBase64.startsWith('http')
      const input = isBase64
        ? [{ type: 'image_base64', image_base64: imageUrlOrBase64.replace(/^data:image\/\w+;base64,/, '') }]
        : [{ type: 'image_url', image_url: imageUrlOrBase64 }]

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

      try {
        const response = await fetch(`${baseUrl}/embeddings/multimodal`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            input,
          }),
          signal: controller.signal,
        })

        const rawText = await response.text()
        if (!response.ok) {
          this.logger.error(`Embedding API error ${response.status}: ${rawText.slice(0, 200)}`)
          return null
        }

        const data = JSON.parse(rawText) as EmbeddingResponse
        const embedding = data.data?.[0]?.embedding
        if (!embedding || !Array.isArray(embedding)) {
          this.logger.error('Embedding API returned no embedding data')
          return null
        }

        this.logger.debug(`Got embedding with ${embedding.length} dimensions`)
        return embedding
      }
      finally {
        clearTimeout(timeout)
      }
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error(`Embedding request timed out after ${this.requestTimeoutMs}ms`)
      }
      else {
        this.logger.error(`Embedding request failed: ${(error as Error).message}`)
      }

      return null
    }
  }

  private getApiKey(): string {
    return (
      process.env['DOUBAO_EMBEDDING_API_KEY']
      || process.env['VOLCENGINE_API_KEY']
      || ''
    ).trim()
  }
}
