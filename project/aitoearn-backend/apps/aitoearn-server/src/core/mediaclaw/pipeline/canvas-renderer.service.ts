import { Injectable } from '@nestjs/common'
import {
  ensureParentDirectory,
  escapeDrawtext,
  normalizeHexColor,
  pathExists,
  runCommand,
} from './pipeline.utils'

export interface CanvasRendererSlide {
  text: string
  duration: number
  bgColor: string
}

interface CanvasRendererOptions {
  width?: number
  height?: number
  frameRate?: number
  textColor?: string
  fontSize?: number
  transitionDuration?: number
  fontFile?: string
}

@Injectable()
export class CanvasRendererService {
  async renderSlides(
    slides: CanvasRendererSlide[],
    outputPath: string,
    options: CanvasRendererOptions = {},
  ): Promise<string> {
    const normalizedSlides = slides
      .map(slide => ({
        text: slide.text.trim(),
        duration: Number(slide.duration || 0),
        bgColor: normalizeHexColor(slide.bgColor, '#111827'),
      }))
      .filter(slide => slide.text && slide.duration > 0)

    if (normalizedSlides.length === 0) {
      throw new Error('Canvas renderer requires at least one slide')
    }

    await ensureParentDirectory(outputPath)

    const width = Number(options.width || 1080)
    const height = Number(options.height || 1920)
    const frameRate = Number(options.frameRate || 30)
    const textColor = normalizeHexColor(options.textColor, '#FFFFFF')
    const fontSize = Number(options.fontSize || 66)
    const transitionDuration = this.resolveTransitionDuration(
      Number(options.transitionDuration || 0.45),
      normalizedSlides,
    )
    const fontFile = await this.resolveFontFile(options.fontFile)

    const args = ['-y']
    const filterParts: string[] = []

    normalizedSlides.forEach((slide) => {
      args.push(
        '-f',
        'lavfi',
        '-t',
        slide.duration.toFixed(3),
        '-i',
        `color=c=${slide.bgColor}:s=${width}x${height}:r=${frameRate}`,
      )
    })

    normalizedSlides.forEach((slide, index) => {
      filterParts.push(
        `${[
          `[${index}:v]drawtext=text='${this.escapeSlideText(slide.text)}'`,
          `fontcolor=${textColor}`,
          `fontsize=${fontSize}`,
          'line_spacing=18',
          'x=(w-text_w)/2',
          'y=(h-text_h)/2',
          'shadowcolor=black@0.65',
          'shadowx=3',
          'shadowy=3',
          'box=1',
          'boxcolor=black@0.16',
          'boxborderw=36',
          'fix_bounds=true',
          fontFile,
        ].filter(Boolean).join(':')}[slide${index}]`,
      )
    })

    if (normalizedSlides.length === 1) {
      filterParts.push('[slide0]format=yuv420p[vout]')
    }
    else {
      let offset = normalizedSlides[0].duration - transitionDuration
      for (let index = 1; index < normalizedSlides.length; index += 1) {
        const leftInput = index === 1 ? '[slide0]' : `[xf${index - 1}]`
        const rightInput = `[slide${index}]`
        const output = index === normalizedSlides.length - 1 ? '[xfinal]' : `[xf${index}]`
        filterParts.push(
          `${leftInput}${rightInput}xfade=transition=fade:duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}${output}`,
        )
        offset += normalizedSlides[index].duration - transitionDuration
      }
      filterParts.push('[xfinal]format=yuv420p[vout]')
    }

    args.push(
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[vout]',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputPath,
    )

    await runCommand('ffmpeg', args, { timeoutMs: 180_000 })

    return outputPath
  }

  private resolveTransitionDuration(
    requestedDuration: number,
    slides: Array<{ duration: number }>,
  ) {
    if (slides.length <= 1) {
      return 0
    }

    const shortestSlide = Math.min(...slides.map(slide => slide.duration))
    return Math.max(0.25, Math.min(requestedDuration, shortestSlide / 3))
  }

  private escapeSlideText(text: string) {
    return escapeDrawtext(this.wrapText(text))
      .replace(/\n/g, '\\n')
  }

  private wrapText(text: string) {
    const normalized = text
      .split(/\r?\n/g)
      .map(line => line.trim())
      .filter(Boolean)
      .join(' ')

    if (!normalized) {
      return ''
    }

    const lines: string[] = []
    let currentLine = ''
    let currentWidth = 0

    for (const char of normalized) {
      const charWidth = /[A-Z0-9 ]/i.test(char) ? 0.6 : 1
      if (currentWidth + charWidth > 14 && currentLine) {
        lines.push(currentLine.trim())
        currentLine = char
        currentWidth = charWidth
        continue
      }

      currentLine += char
      currentWidth += charWidth

      if ('，。！？；：,'.includes(char) && currentWidth >= 8) {
        lines.push(currentLine.trim())
        currentLine = ''
        currentWidth = 0
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trim())
    }

    return lines.slice(0, 6).join('\n')
  }

  private async resolveFontFile(explicitFontFile?: string) {
    const candidates = [
      explicitFontFile?.trim(),
      process.env['MEDIACLAW_SUBTITLE_FONT_FILE']?.trim(),
      '/System/Library/Fonts/PingFang.ttc',
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    ].filter((value): value is string => Boolean(value && value.trim()))

    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return `fontfile=${escapeDrawtext(candidate)}`
      }
    }

    return ''
  }
}
