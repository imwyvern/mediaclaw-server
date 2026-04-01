import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand, ViralContent } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

type LeanBrand = Brand & {
  _id: Types.ObjectId | string | { toString(): string }
}

type LeanViralContent = ViralContent & {
  _id: Types.ObjectId | string | { toString(): string }
}

@Injectable()
export class ContentRemixService {
  private readonly endpoint = 'https://api.vectorengine.cn/v1/chat/completions'
  private readonly model = 'gemini-3.1-pro-preview'
  private readonly requestTimeoutMs = 5000

  constructor(
    @InjectModel(ViralContent.name)
    private readonly viralContentModel: Model<ViralContent>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
  ) {}

  async analyzeViralElements(contentId: string) {
    const content = await this.getViralContent(contentId)

    if (!this.hasApiKey()) {
      this.warnStubFallback('analyzeViralElements')
      return this.buildAnalysisStub(content)
    }

    const completion = await this.requestStructuredCompletion([
      {
        role: 'system',
        content: '你是短视频爆款拆解策略师。只返回 JSON，不要输出 Markdown。',
      },
      {
        role: 'user',
        content: [
          '请基于以下爆款内容，输出 JSON：',
          '{"summary":"","hooks":[],"narrativeBeats":[],"visualMotifs":[],"audioCues":[],"ctaStyle":"","risks":[]}',
          '',
          this.formatViralContent(content),
        ].join('\n'),
      },
    ])

    const parsed = this.parseJsonPayload(completion)

    return {
      source: 'vce_gemini',
      model: this.model,
      contentId: content._id.toString(),
      platform: content.platform,
      videoId: content.videoId,
      title: content.title,
      summary: this.readString(parsed['summary']) || this.buildAnalysisStub(content)['summary'],
      hooks: this.readStringArray(parsed['hooks']),
      narrativeBeats: this.readStringArray(parsed['narrativeBeats']),
      visualMotifs: this.readStringArray(parsed['visualMotifs']),
      audioCues: this.readStringArray(parsed['audioCues']),
      ctaStyle: this.readString(parsed['ctaStyle']),
      risks: this.readStringArray(parsed['risks']),
      raw: completion,
    }
  }

  async generateRemixBrief(contentId: string, brandId: string) {
    const [content, brand] = await Promise.all([
      this.getViralContent(contentId),
      this.getBrand(brandId),
    ])

    if (!this.hasApiKey()) {
      this.warnStubFallback('generateRemixBrief')
      return this.buildBriefStub(content, brand)
    }

    const completion = await this.requestStructuredCompletion([
      {
        role: 'system',
        content: '你是品牌短视频改编导演。只返回 JSON，不要输出 Markdown。',
      },
      {
        role: 'user',
        content: [
          '请基于以下爆款内容和品牌信息，输出 JSON：',
          '{"briefTitle":"","coreAngle":"","targetAudience":"","openingHook":"","scenePlan":[],"copyIdeas":[],"brandSafetyNotes":[],"productionNotes":[]}',
          '',
          '[爆款内容]',
          this.formatViralContent(content),
          '',
          '[品牌信息]',
          this.formatBrand(brand),
        ].join('\n'),
      },
    ])

    const parsed = this.parseJsonPayload(completion)

    return {
      source: 'vce_gemini',
      model: this.model,
      contentId: content._id.toString(),
      brandId: brand._id.toString(),
      briefTitle: this.readString(parsed['briefTitle']) || `${brand.name} 爆款改编简报`,
      coreAngle: this.readString(parsed['coreAngle']),
      targetAudience: this.readString(parsed['targetAudience']),
      openingHook: this.readString(parsed['openingHook']),
      scenePlan: this.readStringArray(parsed['scenePlan']),
      copyIdeas: this.readStringArray(parsed['copyIdeas']),
      brandSafetyNotes: this.readStringArray(parsed['brandSafetyNotes']),
      productionNotes: this.readStringArray(parsed['productionNotes']),
      raw: completion,
    }
  }

  private async getViralContent(contentId: string) {
    if (!Types.ObjectId.isValid(contentId)) {
      throw new NotFoundException('Viral content not found')
    }

    const content = await this.viralContentModel.findById(contentId).lean().exec() as unknown as LeanViralContent | null
    if (!content) {
      throw new NotFoundException('Viral content not found')
    }

    return content
  }

  private async getBrand(brandId: string) {
    if (!Types.ObjectId.isValid(brandId)) {
      throw new NotFoundException('Brand not found')
    }

    const brand = await this.brandModel.findById(brandId).lean().exec() as unknown as LeanBrand | null
    if (!brand) {
      throw new NotFoundException('Brand not found')
    }

    return brand
  }

  private async requestStructuredCompletion(messages: ChatMessage[]) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env['VCE_GEMINI_API_KEY'] || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages,
        }),
        signal: controller.signal,
      })
      const rawText = await response.text()

      if (!response.ok) {
        throw new Error(`VCE Gemini request failed with ${response.status}: ${rawText}`)
      }

      const payload = JSON.parse(rawText) as Record<string, any>
      const content = payload?.['choices']?.[0]?.['message']?.['content']
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('VCE Gemini returned empty content')
      }

      return content
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`VCE Gemini request timed out after ${this.requestTimeoutMs}ms`)
      }

      throw error
    }
    finally {
      clearTimeout(timeout)
    }
  }

  private buildAnalysisStub(content: LeanViralContent) {
    return {
      source: 'stub',
      model: 'stub',
      contentId: content._id.toString(),
      platform: content.platform,
      videoId: content.videoId,
      title: content.title,
      summary: `${content.title || content.videoId} 的爆点主要集中在强开场、明确利益点和高互动话题。`,
      hooks: [
        '前 3 秒直接给出结果或冲突',
        '标题与封面保持同一利益点',
        '评论区引导二次表达',
      ],
      narrativeBeats: [
        '开场抛出问题或结果',
        '中段快速给出 2-3 个关键证据',
        '结尾引导用户模仿或评论',
      ],
      visualMotifs: [
        '近景人物反应',
        '字幕高亮关键收益',
        '节奏快的镜头切换',
      ],
      audioCues: [
        '开头重拍点音效',
        '中段口播节奏加快',
        '结尾用停顿制造评论冲动',
      ],
      ctaStyle: '邀请用户在评论区给出自己的选择或经验',
      risks: [
        '避免绝对化承诺',
        '避免夸张前后对比无法验证',
      ],
    }
  }

  private buildBriefStub(content: LeanViralContent, brand: LeanBrand) {
    return {
      source: 'stub',
      model: 'stub',
      contentId: content._id.toString(),
      brandId: brand._id.toString(),
      briefTitle: `${brand.name} 爆款改编简报`,
      coreAngle: `借用 ${content.platform} 爆款结构，把 ${brand.name} 的核心卖点前置到前 3 秒。`,
      targetAudience: brand.industry || content.industry || '泛内容消费人群',
      openingHook: `先抛出 ${brand.name} 用户最常见的一个痛点，再立刻给出反差结果。`,
      scenePlan: [
        '镜头 1: 3 秒内抛出痛点和结果',
        '镜头 2: 展示品牌解决方案的关键动作',
        '镜头 3: 用真实场景强化可信度',
        '镜头 4: 结尾导向评论或私信',
      ],
      copyIdeas: [
        `${brand.name} 为什么更容易被记住？`,
        `同样预算下，${brand.name} 的优势到底在哪？`,
        '一个动作解释清楚核心差异点',
      ],
      brandSafetyNotes: [
        ...(brand.assets?.prohibitedWords || []).slice(0, 3),
        '避免使用未经验证的疗效或收益承诺',
      ],
      productionNotes: [
        '保留原爆款快节奏结构，但替换成品牌真实场景',
        '字幕只保留一个主利益点，避免信息拥堵',
      ],
    }
  }

  private formatViralContent(content: LeanViralContent) {
    return [
      `平台: ${content.platform}`,
      `视频ID: ${content.videoId}`,
      `标题: ${content.title || ''}`,
      `作者: ${content.author || ''}`,
      `行业: ${content.industry || ''}`,
      `关键词: ${(content.keywords || []).join(', ')}`,
      `播放: ${content.views || 0}`,
      `点赞: ${content.likes || 0}`,
      `评论: ${content.comments || 0}`,
      `分享: ${content.shares || 0}`,
      `爆款分: ${content.viralScore || 0}`,
      `链接: ${content.contentUrl || ''}`,
    ].join('\n')
  }

  private formatBrand(brand: LeanBrand) {
    return [
      `品牌名: ${brand.name}`,
      `行业: ${brand.industry || ''}`,
      `品牌关键词: ${(brand.assets?.keywords || []).join(', ')}`,
      `口号: ${(brand.assets?.slogans || []).join(', ')}`,
      `禁用词: ${(brand.assets?.prohibitedWords || []).join(', ')}`,
    ].join('\n')
  }

  private hasApiKey() {
    return Boolean(process.env['VCE_GEMINI_API_KEY']?.trim())
  }

  private warnStubFallback(method: string) {
    console.warn(`[ContentRemixService] ${method} fallback to stub because VCE_GEMINI_API_KEY is not configured.`)
  }

  private parseJsonPayload(content: string) {
    const normalized = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    try {
      return JSON.parse(normalized) as Record<string, unknown>
    }
    catch {
      return {}
    }
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private readStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
  }
}
