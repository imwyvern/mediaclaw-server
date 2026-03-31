import { Injectable } from '@nestjs/common'
import { PipelineDedupStrategy } from './pipeline.types'
import { hashToRange, runCommand } from './pipeline.utils'

interface ApplyDedupParams {
  inputVideoPath: string
  outputVideoPath: string
  strategy: PipelineDedupStrategy
  preserveAudio: boolean
}

@Injectable()
export class DedupService {
  createStrategy(
    taskId: string,
    seedSource: string,
    brandColors: string[] = [],
    preserveAudio = false,
  ): PipelineDedupStrategy {
    const seed = `${taskId}:${seedSource}:${brandColors.join(',')}`

    return {
      cropScale: hashToRange(seed, 1.01, 1.04),
      cropXRatio: hashToRange(`${seed}:x`, 0.04, 0.18),
      cropYRatio: hashToRange(`${seed}:y`, 0.04, 0.16),
      hueShift: hashToRange(`${seed}:h`, -3, 3),
      saturation: hashToRange(`${seed}:s`, 1.01, 1.05),
      contrast: hashToRange(`${seed}:c`, 1.01, 1.04),
      brightness: hashToRange(`${seed}:b`, -0.01, 0.02),
      noise: hashToRange(`${seed}:n`, 2, 6),
      speedFactor: preserveAudio ? 1 : hashToRange(`${seed}:spd`, 0.992, 1.008, 6),
      metadataFingerprint: `mediaclaw-${Math.abs(seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0))}`,
    }
  }

  async applyVideoPostProcess(params: ApplyDedupParams) {
    const zoomScale = params.strategy.cropScale.toFixed(4)
    const cropWidthExpr = `(iw/${zoomScale})`
    const cropHeightExpr = `(ih/${zoomScale})`
    const cropXExpr = `(in_w-out_w)*${params.strategy.cropXRatio.toFixed(4)}`
    const cropYExpr = `(in_h-out_h)*${params.strategy.cropYRatio.toFixed(4)}`
    const setPtsExpr = `${(1 / params.strategy.speedFactor).toFixed(6)}*PTS`

    const videoFilters = [
      `scale=iw*${zoomScale}:ih*${zoomScale}`,
      `crop=${cropWidthExpr}:${cropHeightExpr}:${cropXExpr}:${cropYExpr}`,
      `eq=contrast=${params.strategy.contrast.toFixed(4)}:brightness=${params.strategy.brightness.toFixed(4)}:saturation=${params.strategy.saturation.toFixed(4)}`,
      `hue=h=${params.strategy.hueShift.toFixed(2)}`,
      `noise=alls=${params.strategy.noise.toFixed(2)}:allf=t+u`,
      `setpts=${setPtsExpr}`,
    ].join(',')

    const args = [
      '-y',
      '-i',
      params.inputVideoPath,
      '-vf',
      videoFilters,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-metadata',
      `comment=${params.strategy.metadataFingerprint}`,
    ]

    if (params.preserveAudio) {
      args.push(
        '-map',
        '0:v',
        '-map',
        '0:a?',
        '-c:a',
        'copy',
        '-shortest',
      )
    }
    else {
      args.push('-an')
    }

    args.push(params.outputVideoPath)

    await runCommand('ffmpeg', args, { timeoutMs: 180_000 })
  }
}
