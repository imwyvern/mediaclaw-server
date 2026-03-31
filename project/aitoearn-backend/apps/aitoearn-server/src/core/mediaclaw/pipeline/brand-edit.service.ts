import { Injectable, Logger } from '@nestjs/common'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PipelineFrameArtifact, PipelineJobContext } from './pipeline.types'
import { downloadFile, requestJson } from './pipeline.utils'

interface VectorEngineImageResponse {
  data?: Array<Record<string, unknown>>
  output?: Record<string, unknown> | string
  result?: Record<string, unknown>
}

@Injectable()
export class BrandEditService {
  private readonly logger = new Logger(BrandEditService.name)

  async applyBranding(context: PipelineJobContext): Promise<PipelineFrameArtifact[]> {
    const provider = this.resolveProvider()
    const artifacts: PipelineFrameArtifact[] = []

    for (const frame of context.frameArtifacts) {
      const editedPath = join(context.workspaceDir, `edited-frame-${frame.index + 1}.png`)
      if (provider === 'vectorengine') {
        await this.applyVectorEngineEdit(context, frame, editedPath)
      }
      else {
        await copyFile(frame.sourcePath, editedPath)
      }

      artifacts.push({
        ...frame,
        editedPath,
      })
    }

    return artifacts
  }

  private resolveProvider() {
    const provider = process.env['MEDIACLAW_BRAND_EDIT_PROVIDER']?.trim().toLowerCase()
    const apiKey = process.env['MEDIACLAW_VCE_API_KEY']?.trim()
    if (provider === 'vectorengine' && apiKey) {
      return 'vectorengine'
    }

    if (provider === 'vectorengine' && !apiKey) {
      this.logger.warn('MEDIACLAW_VCE_API_KEY 缺失，品牌编辑降级为 mock 模式')
    }

    return 'mock'
  }

  private async applyVectorEngineEdit(
    context: PipelineJobContext,
    frame: PipelineFrameArtifact,
    editedPath: string,
  ) {
    const baseUrl = process.env['MEDIACLAW_VCE_BASE_URL']?.trim() || 'https://api.vectorengine.cn'
    const editPath = process.env['MEDIACLAW_VCE_EDIT_PATH']?.trim() || '/v1/images/edits'
    const apiKey = process.env['MEDIACLAW_VCE_API_KEY']?.trim()
    const model = process.env['MEDIACLAW_VCE_MODEL']?.trim() || 'gemini-2.5-flash-image'
    if (!apiKey) {
      await copyFile(frame.sourcePath, editedPath)
      return
    }

    const prompt = this.buildPrompt(context, frame)
    const imageBase64 = (await readFile(frame.sourcePath)).toString('base64')

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await requestJson<VectorEngineImageResponse>(
          `${baseUrl.replace(/\/+$/, '')}${editPath}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              prompt,
              image: imageBase64,
              response_format: 'url',
            }),
            timeoutMs: 120_000,
          },
        )
        await this.persistEditedFrame(response, editedPath)
        return
      }
      catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown brand edit error')
        this.logger.warn(`品牌编辑重试 ${attempt}/3 失败: ${lastError.message}`)
      }
    }

    throw lastError || new Error('Brand edit failed')
  }

  private buildPrompt(context: PipelineJobContext, frame: PipelineFrameArtifact) {
    const colors = context.brand.colors.slice(0, 3).join(', ') || 'brand primary palette'
    const slogans = context.brand.slogans.slice(0, 2).join(' / ')
    const keywords = context.brand.keywords.slice(0, 4).join(', ')
    const prohibited = context.brand.prohibitedWords.slice(0, 4).join(', ')

    return [
      `Edit the frame for brand ${context.brand.name}.`,
      `Keep the original composition and motion clue for the ${frame.label} shot.`,
      `Use brand colors: ${colors}.`,
      slogans ? `Reflect slogans: ${slogans}.` : '',
      keywords ? `Highlight keywords: ${keywords}.` : '',
      prohibited ? `Avoid words or visual claims: ${prohibited}.` : '',
      'No mask is required in phase 1. The logo area should remain clean for post subtitle brand text.',
    ].filter(Boolean).join(' ')
  }

  private async persistEditedFrame(response: VectorEngineImageResponse, editedPath: string) {
    const url = this.pickStringCandidate([
      response.data?.[0]?.['url'],
      response.data?.[0]?.['image_url'],
      response.data?.[0]?.['output_url'],
      this.extractRecord(response.output)?.['url'],
      this.extractRecord(response.result)?.['url'],
      typeof response.output === 'string' ? response.output : undefined,
    ])

    if (url) {
      await downloadFile(url, editedPath)
      return
    }

    const base64Value = this.pickStringCandidate([
      response.data?.[0]?.['b64_json'],
      response.data?.[0]?.['image_base64'],
      this.extractRecord(response.output)?.['b64_json'],
      this.extractRecord(response.result)?.['image_base64'],
    ])

    if (!base64Value) {
      throw new Error('VectorEngine response did not include image payload')
    }

    await writeFile(editedPath, Buffer.from(base64Value, 'base64'))
  }

  private pickStringCandidate(candidates: unknown[]) {
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate
      }
    }

    return null
  }

  private extractRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }
}
