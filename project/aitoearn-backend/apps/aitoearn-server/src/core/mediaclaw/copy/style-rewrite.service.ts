import { BadRequestException, Injectable } from '@nestjs/common'
import { CopyEngineService } from './copy-engine.service'

interface RewriteMetadata {
  orgId?: string | null
  userId?: string | null
  taskId?: string | null
  brandId?: string | null
}

@Injectable()
export class StyleRewriteService {
  constructor(private readonly copyEngineService: CopyEngineService) {}

  async rewriteForPlatform(
    copyText: string,
    fromPlatform: string,
    toPlatform: string,
    styleGuide?: string,
    metadata: RewriteMetadata = {},
  ) {
    const normalizedText = copyText.trim()
    if (!normalizedText) {
      throw new BadRequestException('text is required')
    }

    const normalizedFromPlatform = this.normalizePlatform(fromPlatform) || '通用内容'
    const normalizedToPlatform = this.normalizePlatform(toPlatform)
    if (!normalizedToPlatform) {
      throw new BadRequestException('toPlatform is required')
    }

    const heuristic = this.buildHeuristicPlatformRewrite(
      normalizedText,
      normalizedToPlatform,
      styleGuide,
    )
    const prompt = this.buildPlatformRewritePrompt(
      normalizedText,
      normalizedFromPlatform,
      normalizedToPlatform,
      styleGuide,
    )

    const rewritten = await this.copyEngineService.generateText(
      prompt,
      {
        ...metadata,
        orgId: metadata.orgId || undefined,
        userId: metadata.userId || undefined,
        taskId: metadata.taskId || undefined,
        brandId: metadata.brandId || undefined,
      },
      {
        systemPrompt: '你是 MediaClaw 的平台文案改写引擎。仅输出改写后的最终文案正文，不要解释，不要加引号。',
        temperature: 0.75,
        fallbackText: heuristic,
        usageSource: 'copy-style-rewrite',
        brandId: metadata.brandId || null,
      },
    )

    return {
      text: rewritten.text || heuristic,
      provider: rewritten.provider,
      fromPlatform: normalizedFromPlatform,
      toPlatform: normalizedToPlatform,
      styleGuide: styleGuide?.trim() || '',
    }
  }

  async rewriteWithStyle(
    copyText: string,
    styleGuide: string,
    metadata: RewriteMetadata = {},
  ) {
    const normalizedText = copyText.trim()
    const normalizedStyleGuide = styleGuide.trim()

    if (!normalizedText) {
      throw new BadRequestException('text is required')
    }
    if (!normalizedStyleGuide) {
      throw new BadRequestException('styleGuide is required')
    }

    const heuristic = `${normalizedText}\n\n风格要求：${normalizedStyleGuide}`
    const prompt = [
      '请基于以下原始文案做风格改写，保持核心信息不变，但整体表达必须严格贴合风格指南。',
      `原始文案:\n${normalizedText}`,
      `风格指南:\n${normalizedStyleGuide}`,
      '输出要求:',
      '- 只输出最终文案',
      '- 不解释改写理由',
      '- 不要添加 JSON、标题或多余前缀',
    ].join('\n')

    const rewritten = await this.copyEngineService.generateText(
      prompt,
      metadata,
      {
        systemPrompt: '你是 MediaClaw 的品牌风格改写引擎。仅输出最终文案正文。',
        temperature: 0.7,
        fallbackText: heuristic,
        usageSource: 'copy-style-guide-rewrite',
        brandId: metadata.brandId || null,
      },
    )

    return {
      text: rewritten.text || heuristic,
      provider: rewritten.provider,
      styleGuide: normalizedStyleGuide,
    }
  }

  private buildPlatformRewritePrompt(
    copyText: string,
    fromPlatform: string,
    toPlatform: string,
    styleGuide?: string,
  ) {
    return [
      '请将下面的文案改写成目标平台更容易起量、可直接发布的版本。',
      `原平台: ${fromPlatform}`,
      `目标平台: ${toPlatform}`,
      `原始文案:\n${copyText}`,
      `目标平台风格规则:\n${this.getPlatformRules(toPlatform)}`,
      styleGuide?.trim() ? `额外品牌风格指南:\n${styleGuide.trim()}` : '',
      '输出要求:',
      '- 保留原始核心卖点与信息顺序',
      '- 不要写解释',
      '- 只输出最终文案正文',
    ].filter(Boolean).join('\n')
  }

  private buildHeuristicPlatformRewrite(
    copyText: string,
    toPlatform: string,
    styleGuide?: string,
  ) {
    const normalizedStyleGuide = styleGuide?.trim()
    switch (toPlatform) {
      case '抖音':
        return [
          this.ensureHookOpening(copyText),
          '节奏拉满，先看结果再看方法。',
          normalizedStyleGuide ? `风格补充：${normalizedStyleGuide}` : '',
          '评论区告诉我你最想抄哪一步。',
          '🔥⚡️',
        ].filter(Boolean).join('\n')
      case '小红书':
        return [
          '先说结论：这版真的更适合直接种草。',
          '',
          copyText,
          '',
          '如果你也想把内容改成更容易收藏和转发的版本，可以先从这几个点下手。',
          normalizedStyleGuide ? `品牌语气：${normalizedStyleGuide}` : '',
          '#干货分享 #种草文案 #品牌增长',
        ].filter(Boolean).join('\n')
      case '快手':
        return [
          '说实话，这样改更接地气。',
          copyText,
          normalizedStyleGuide ? `记得带上这个感觉：${normalizedStyleGuide}` : '',
          '要的是实在、顺嘴、让人一听就懂。',
        ].filter(Boolean).join('\n')
      default:
        return [
          copyText,
          normalizedStyleGuide ? `风格要求：${normalizedStyleGuide}` : '',
        ].filter(Boolean).join('\n')
    }
  }

  private ensureHookOpening(copyText: string) {
    const normalized = copyText.trim()
    if (!normalized) {
      return ''
    }

    if (/^(别划走|先别划走|直接说|先说结论|注意)/.test(normalized)) {
      return normalized
    }

    return `先说结论：${normalized}`
  }

  private getPlatformRules(platform: string) {
    switch (platform) {
      case '抖音':
        return '强 hook 开头，节奏快，句子更短，情绪更直接，emoji 可以更密集。'
      case '小红书':
        return '种草语气，分段清晰，强调体验和建议，适当补充标签。'
      case '快手':
        return '更接地气，更口语化，更像真人当面分享，不要过度包装。'
      default:
        return '保持自然表达，兼顾信息密度和可读性。'
    }
  }

  private normalizePlatform(platform: string) {
    const normalized = platform.trim().toLowerCase()
    if (!normalized) {
      return ''
    }

    switch (normalized) {
      case 'douyin':
      case '抖音':
        return '抖音'
      case 'xiaohongshu':
      case 'rednote':
      case '小红书':
        return '小红书'
      case 'kuaishou':
      case '快手':
        return '快手'
      default:
        return platform.trim()
    }
  }
}
