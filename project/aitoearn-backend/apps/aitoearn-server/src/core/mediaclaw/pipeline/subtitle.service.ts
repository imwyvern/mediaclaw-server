import { Injectable } from '@nestjs/common'
import { join } from 'node:path'
import { PipelineJobContext } from './pipeline.types'
import { escapeDrawtext, normalizeHexColor, pathExists, runCommand } from './pipeline.utils'

@Injectable()
export class SubtitleService {
  async renderSubtitles(context: PipelineJobContext) {
    const inputPath = context.composedVideoPath
    if (!inputPath) {
      throw new Error('composedVideoPath is required before subtitle rendering')
    }

    const outputPath = join(context.workspaceDir, 'subtitled.mp4')
    const drawtextAvailable = await this.hasDrawtext()

    if (drawtextAvailable) {
      await this.renderWithDrawtext(context, inputPath, outputPath)
      return outputPath
    }

    await this.renderWithOverlay(context, inputPath, outputPath)
    return outputPath
  }

  private async hasDrawtext() {
    try {
      const { stdout } = await runCommand('ffmpeg', ['-hide_banner', '-filters'], { timeoutMs: 15_000 })
      return stdout.includes('drawtext')
    }
    catch {
      return false
    }
  }

  private async renderWithDrawtext(context: PipelineJobContext, inputPath: string, outputPath: string) {
    const subtitleStyle = context.brand.subtitleStyle
    const textColor = normalizeHexColor(this.readString(subtitleStyle, 'textColor'), '#FFFFFF')
    const accentColor = normalizeHexColor(this.readString(subtitleStyle, 'accentColor'), '#F8D34B')
    const fontSize = this.readNumber(subtitleStyle, 'fontSize') || 54
    const fontFile = await this.resolveFontFile(context)
    const watermarkText = escapeDrawtext(context.brand.name)
    const aiLabelText = escapeDrawtext('AI Deep Synthesis')

    const filterParts = [
      `drawbox=x=40:y=h-260:w=w-80:h=180:color=black@0.35:t=fill`,
      `drawtext=text='${aiLabelText}':fontcolor=${accentColor}:fontsize=28:x=40:y=42${fontFile}`,
      `drawtext=text='${watermarkText}':fontcolor=${textColor}:fontsize=28:x=w-text_w-40:y=42${fontFile}`,
    ]

    for (const subtitle of context.subtitles) {
      filterParts.push(
        `drawtext=text='${escapeDrawtext(subtitle.text)}':fontcolor=${textColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=h-170:enable='between(t,${subtitle.startSeconds.toFixed(3)},${subtitle.endSeconds.toFixed(3)})'${fontFile}`,
      )
    }

    await runCommand(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-vf',
        filterParts.join(','),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        '-metadata',
        'comment=AI deep synthesis watermark',
        outputPath,
      ],
      { timeoutMs: 180_000 },
    )
  }

  private async renderWithOverlay(context: PipelineJobContext, inputPath: string, outputPath: string) {
    const overlayPath = join(context.workspaceDir, 'subtitle-overlay.png')
    const primarySubtitle = context.subtitles[0]?.text || context.brand.name
    const scriptPath = join(__dirname, 'subtitle-overlay.py')
    await runCommand(
      'python3',
      [
        scriptPath,
        '--width',
        String(context.renderWidth),
        '--height',
        String(context.renderHeight),
        '--text',
        primarySubtitle,
        '--ai-label',
        'AI Deep Synthesis',
        '--watermark',
        context.brand.name,
        '--output',
        overlayPath,
      ],
      { timeoutMs: 30_000 },
    )

    await runCommand(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-i',
        overlayPath,
        '-filter_complex',
        'overlay=0:0',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        outputPath,
      ],
      { timeoutMs: 180_000 },
    )
  }

  private readString(source: Record<string, unknown>, key: string) {
    const value = source[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  private readNumber(source: Record<string, unknown>, key: string) {
    const value = source[key]
    return typeof value === 'number' ? value : null
  }

  private async resolveFontFile(context: PipelineJobContext) {
    const candidates = [
      process.env['MEDIACLAW_SUBTITLE_FONT_FILE']?.trim(),
      ...context.brand.fonts,
      '/System/Library/Fonts/PingFang.ttc',
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    ].filter((value): value is string => Boolean(value && value.trim()))

    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return `:fontfile=${escapeDrawtext(candidate)}`
      }
    }

    return ''
  }
}
