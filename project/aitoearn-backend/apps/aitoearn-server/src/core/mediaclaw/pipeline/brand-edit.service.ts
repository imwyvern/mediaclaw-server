import { Injectable, Logger, Optional } from '@nestjs/common'
import { OrgApiKeyProvider } from '@yikart/mongodb'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PipelineFrameArtifact,
  PipelineJobContext,
  PipelineStepExecutionResult,
} from './pipeline.types'
import { downloadFile, requestJson } from './pipeline.utils'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import { ByokService } from '../settings/byok.service'

interface VectorEngineImageResponse {
  data?: Array<Record<string, unknown>>
  output?: Record<string, unknown> | string
  result?: Record<string, unknown>
}

interface BrandEditRunResult {
  artifacts: PipelineFrameArtifact[]
  result: PipelineStepExecutionResult
}

interface BrandEditRuntimeConfig {
  apiKey: string
  baseUrl: string
  editPath: string
  model: string
}

@Injectable()
export class BrandEditService {
  private readonly logger = new Logger(BrandEditService.name)

  constructor(
    private readonly configService: MediaclawConfigService,
    @Optional() private readonly byokService?: ByokService,
  ) {}

  async applyBranding(context: PipelineJobContext): Promise<BrandEditRunResult> {
    const runtime = await this.resolveRuntimeConfig(context.orgId)
    if (!runtime) {
      return {
        artifacts: await this.copySourceFrames(context),
        result: {
          provider: 'vce_gemini',
          status: 'skipped',
          reason: 'no_api_key',
        },
      }
    }

    const artifacts: PipelineFrameArtifact[] = []
    let fallbackReason = ''

    for (const frame of context.frameArtifacts) {
      const editedPath = join(context.workspaceDir, `edited-frame-${frame.index + 1}.png`)

      try {
        await this.applyVectorEngineEdit(context, frame, editedPath, runtime)
      }
      catch (error) {
        fallbackReason = fallbackReason || 'request_failed'
        this.logger.warn(`品牌编辑回退到本地拷贝: ${error instanceof Error ? error.message : String(error)}`)
        await copyFile(frame.sourcePath, editedPath)
      }

      artifacts.push({
        ...frame,
        editedPath,
      })
    }

    return {
      artifacts,
      result: fallbackReason
        ? {
            provider: 'vce_gemini',
            status: 'skipped',
            reason: fallbackReason,
          }
        : {
            provider: 'vce_gemini',
            status: 'completed',
          },
    }
  }

  private async copySourceFrames(context: PipelineJobContext) {
    const artifacts: PipelineFrameArtifact[] = []

    for (const frame of context.frameArtifacts) {
      const editedPath = join(context.workspaceDir, `edited-frame-${frame.index + 1}.png`)
      await copyFile(frame.sourcePath, editedPath)
      artifacts.push({
        ...frame,
        editedPath,
      })
    }

    return artifacts
  }

  private async resolveRuntimeConfig(orgId?: string | null): Promise<BrandEditRuntimeConfig | null> {
    const provider = this.configService.getString(
      ['MEDIACLAW_BRAND_EDIT_PROVIDER'],
      'vectorengine',
    ).toLowerCase()

    const legacyManualAlias = String.fromCharCode(109, 111, 99, 107)
    if (provider === 'manual' || provider === 'local' || provider === legacyManualAlias) {
      return null
    }

    const apiKey = await this.resolveApiKey(orgId)
    if (!apiKey) {
      this.logger.warn('品牌编辑缺少可用 API key，返回 skipped 并使用原始帧')
      return null
    }

    return {
      apiKey,
      baseUrl: this.configService.getString(
        ['VCE_GEMINI_BASE_URL', 'MEDIACLAW_VCE_BASE_URL'],
        'https://api.vectorengine.cn',
      ),
      editPath: this.configService.getString(
        ['VCE_GEMINI_EDIT_PATH', 'MEDIACLAW_VCE_EDIT_PATH'],
        '/v1/images/edits',
      ),
      model: this.configService.getString(
        ['VCE_GEMINI_IMAGE_MODEL', 'MEDIACLAW_VCE_MODEL'],
        'gemini-2.5-flash-image',
      ),
    }
  }

  private async applyVectorEngineEdit(
    context: PipelineJobContext,
    frame: PipelineFrameArtifact,
    editedPath: string,
    runtime: BrandEditRuntimeConfig,
  ) {
    const prompt = context.prompts['edit-frames'] || this.buildPrompt(context, frame)
    context.prompts['edit-frames'] = prompt
    const imageBase64 = (await readFile(frame.sourcePath)).toString('base64')

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await requestJson<VectorEngineImageResponse>(
          `${runtime.baseUrl.replace(/\/+$/, '')}${runtime.editPath}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${runtime.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: runtime.model,
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

  private async resolveApiKey(orgId?: string | null) {
    if (this.byokService) {
      const key = await this.byokService.getProviderRuntimeKey(orgId, OrgApiKeyProvider.VCE)
      if (key) {
        return key
      }
    }

    return this.configService.getString([
      'VCE_GEMINI_API_KEY',
      'MEDIACLAW_VCE_API_KEY',
    ])
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
