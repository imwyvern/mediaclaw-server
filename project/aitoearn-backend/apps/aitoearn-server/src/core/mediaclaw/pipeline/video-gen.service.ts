import { Injectable, Logger, Optional } from '@nestjs/common'
import { OrgApiKeyProvider } from '@yikart/mongodb'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PipelineFrameArtifact, PipelineJobContext } from './pipeline.types'
import { downloadFile, requestJson, runCommand } from './pipeline.utils'
import { ByokService } from '../settings/byok.service'

interface KlingCreateResponse {
  id?: string
  task_id?: string
  data?: Record<string, unknown>
}

interface KlingStatusResponse {
  status?: string
  data?: Record<string, unknown>
  output?: Record<string, unknown>
  result?: Record<string, unknown>
}

@Injectable()
export class VideoGenService {
  private readonly logger = new Logger(VideoGenService.name)

  constructor(
    @Optional() private readonly byokService?: ByokService,
  ) {}

  async generateSegments(context: PipelineJobContext) {
    const provider = await this.resolveProvider(context.orgId)
    const segmentDurationSeconds = this.resolveSegmentDuration(context)
    const segmentPaths: string[] = []

    for (const frame of context.frameArtifacts) {
      const outputPath = join(context.workspaceDir, `segment-${frame.index + 1}.mp4`)
      if (provider === 'vectorengine') {
        await this.generateWithKling(context, frame, outputPath, segmentDurationSeconds)
      }
      else {
        await this.generateMockSegment(context, frame, outputPath, segmentDurationSeconds)
      }
      segmentPaths.push(outputPath)
    }

    return segmentPaths
  }

  async composeSegments(context: PipelineJobContext, segmentVideoPaths: string[]) {
    const baseOutputPath = join(context.workspaceDir, 'composed-base.mp4')
    const finalOutputPath = join(context.workspaceDir, 'composed.mp4')
    const transitionDuration = 0.4
    const segmentDuration = this.resolveSegmentDuration(context)

    if (segmentVideoPaths.length === 0) {
      throw new Error('No segment videos available for composition')
    }

    if (segmentVideoPaths.length === 1) {
      await runCommand(
        'ffmpeg',
        [
          '-y',
          '-i',
          segmentVideoPaths[0],
          '-map',
          '0:v',
          '-an',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          baseOutputPath,
        ],
        { timeoutMs: 120_000 },
      )
    }
    else {
      const args = ['-y']
      for (const segmentPath of segmentVideoPaths) {
        args.push('-i', segmentPath)
      }

      const filterParts: string[] = []
      let offset = segmentDuration - transitionDuration
      for (let index = 1; index < segmentVideoPaths.length; index += 1) {
        const leftInput = index === 1 ? '[0:v]' : `[v${index - 1}]`
        const rightInput = `[${index}:v]`
        const output = index === segmentVideoPaths.length - 1 ? '[vout]' : `[v${index}]`
        filterParts.push(
          `${leftInput}${rightInput}xfade=transition=fade:duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}${output}`,
        )
        offset += segmentDuration - transitionDuration
      }

      args.push(
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        '[vout]',
        '-an',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        baseOutputPath,
      )

      await runCommand('ffmpeg', args, { timeoutMs: 180_000 })
    }

    if (!context.preserveSourceAudio || !context.sourceMetadata.hasAudio) {
      return baseOutputPath
    }

    await runCommand(
      'ffmpeg',
      [
        '-y',
        '-i',
        baseOutputPath,
        '-i',
        context.sourceVideoPath,
        '-map',
        '0:v',
        '-map',
        '1:a?',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-shortest',
        finalOutputPath,
      ],
      { timeoutMs: 180_000 },
    )

    return finalOutputPath
  }

  private async resolveProvider(orgId?: string | null) {
    const provider = process.env['MEDIACLAW_VIDEO_GEN_PROVIDER']?.trim().toLowerCase()
    const apiKey = await this.resolveApiKey(orgId)
    if (provider === 'vectorengine' && apiKey) {
      return 'vectorengine'
    }

    if (provider === 'vectorengine' && !apiKey) {
      this.logger.warn('视频生成缺少可用 API key，降级为 mock 模式')
    }

    return 'mock'
  }

  private async resolveApiKey(orgId?: string | null) {
    if (this.byokService) {
      const key = await this.byokService.getProviderRuntimeKey(
        orgId,
        OrgApiKeyProvider.KLING,
        'MEDIACLAW_KLING_API_KEY',
      )
      if (key) {
        return key
      }
    }

    return process.env['MEDIACLAW_KLING_API_KEY']?.trim() || ''
  }
  private resolveSegmentDuration(context: PipelineJobContext) {
    const segmentCount = context.frameArtifacts.length || 3
    return Number(Math.max(context.targetDurationSeconds / segmentCount, 3).toFixed(3))
  }

  private async generateMockSegment(
    context: PipelineJobContext,
    frame: PipelineFrameArtifact,
    outputPath: string,
    durationSeconds: number,
  ) {
    const inputPath = frame.editedPath || frame.sourcePath
    await runCommand(
      'ffmpeg',
      [
        '-y',
        '-loop',
        '1',
        '-i',
        inputPath,
        '-vf',
        `scale=${context.renderWidth}:${context.renderHeight}:force_original_aspect_ratio=increase,crop=${context.renderWidth}:${context.renderHeight},zoompan=z='min(zoom+0.0008,1.08)':d=150:s=${context.renderWidth}x${context.renderHeight},fps=30`,
        '-t',
        durationSeconds.toFixed(3),
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        outputPath,
      ],
      { timeoutMs: 120_000 },
    )
  }

  private async generateWithKling(
    context: PipelineJobContext,
    frame: PipelineFrameArtifact,
    outputPath: string,
    durationSeconds: number,
  ) {
    const baseUrl = process.env['MEDIACLAW_KLING_BASE_URL']?.trim() || 'https://api.vectorengine.ai'
    const createPath = process.env['MEDIACLAW_KLING_CREATE_PATH']?.trim() || '/v1/videos'
    const statusPathTemplate = process.env['MEDIACLAW_KLING_STATUS_PATH']?.trim() || '/v1/videos/{taskId}'
    const apiKey = await this.resolveApiKey(context.orgId)
    const model = process.env['MEDIACLAW_KLING_MODEL']?.trim() || 'kling-v3-omni'
    if (!apiKey) {
      await this.generateMockSegment(context, frame, outputPath, durationSeconds)
      return
    }

    const inputPath = frame.editedPath || frame.sourcePath
    const imageBase64 = (await readFile(inputPath)).toString('base64')
    const prompt = context.prompts['render-video'] || [
      `Generate a short branded video clip for ${context.brand.name}.`,
      `Use the ${frame.label} frame as the driving image.`,
      `Keep it vertical ${context.renderWidth}x${context.renderHeight}.`,
      `The brand text will be added after subtitle rendering, so keep lower thirds clean.`,
    ].join(' ')
    context.prompts['render-video'] = prompt

    const createResponse = await requestJson<KlingCreateResponse>(
      `${baseUrl.replace(/\/+$/, '')}${createPath}`,
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
          duration: Number(durationSeconds.toFixed(1)),
          width: context.renderWidth,
          height: context.renderHeight,
        }),
        timeoutMs: 120_000,
      },
    )

    const taskId = this.pickStringCandidate([
      createResponse.task_id,
      createResponse.id,
      createResponse.data?.['task_id'],
      createResponse.data?.['id'],
    ])

    if (!taskId) {
      throw new Error('Kling response missing task id')
    }

    const intervalMs = Number(process.env['MEDIACLAW_KLING_POLL_INTERVAL_MS'] || 5_000)
    const maxPolls = Number(process.env['MEDIACLAW_KLING_MAX_POLLS'] || 24)

    for (let poll = 1; poll <= maxPolls; poll += 1) {
      const statusPath = statusPathTemplate.replace('{taskId}', taskId)
      const statusResponse = await requestJson<KlingStatusResponse>(
        `${baseUrl.replace(/\/+$/, '')}${statusPath}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          timeoutMs: 120_000,
        },
      )

      const status = this.pickStringCandidate([
        statusResponse.status,
        statusResponse.data?.['status'],
        statusResponse.output?.['status'],
        statusResponse.result?.['status'],
      ])?.toLowerCase()

      if (status === 'succeeded' || status === 'success' || status === 'completed') {
        const url = this.pickStringCandidate([
          statusResponse.data?.['url'],
          statusResponse.data?.['video_url'],
          statusResponse.output?.['url'],
          statusResponse.result?.['url'],
        ])
        if (!url) {
          throw new Error('Kling status response missing video url')
        }
        await downloadFile(url, outputPath)
        return
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(`Kling generation failed for ${taskId}`)
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }

    throw new Error(`Kling generation timed out for ${taskId}`)
  }

  private pickStringCandidate(candidates: unknown[]) {
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate
      }
    }

    return null
  }
}
