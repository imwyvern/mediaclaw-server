import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Brand, CopyHistory } from '@yikart/mongodb'

export interface GeneratedCopy {
  title: string
  subtitle: string
  hashtags: string[]
  commentGuide: string
}

interface CopyHistoryPayload extends GeneratedCopy {
  blueWords: string[]
  orgId?: string | null
  taskId?: string | null
}

@Injectable()
export class CopyEngineService {
  constructor(
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(CopyHistory.name) private readonly copyHistoryModel: Model<CopyHistory>,
  ) {}

  async generateCopy(
    brandId: string | null | undefined,
    videoUrl: string,
    metadata: Record<string, any> = {},
  ): Promise<GeneratedCopy> {
    const brand = brandId
      ? await this.brandModel.findById(brandId).lean().exec()
      : null

    const brandName = brand?.name || 'MediaClaw'
    const toneKeywords = brand?.assets?.keywords || []
    const avoidKeywords = brand?.assets?.prohibitedWords || []
    const primaryTone = toneKeywords[0] || '品牌感'
    const scene = metadata['scene'] || metadata['campaign'] || '内容分发'
    const sourceHint = videoUrl ? '视频源素材已同步到文案上下文。' : ''
    const baseTitle = `${brandName}${primaryTone}短视频`
    const dedup = brand?.orgId
      ? await this.checkDedupHistory(brand.orgId.toString(), { title: baseTitle, subtitle: scene })
      : { isDuplicate: false }
    const titleSeed = dedup.isDuplicate
      ? this.generateABVariants(baseTitle, 3)[0] || baseTitle
      : baseTitle
    const blueWordResult = this.generateBlueWords(titleSeed, toneKeywords)
    const subtitle = `${scene}场景成片已生成，突出${toneKeywords.slice(0, 2).join('、') || '品牌识别度'}`
    const commentGuide = avoidKeywords.length > 0
      ? `评论区建议引导体验和反馈，避免提及：${avoidKeywords.join('、')}。${sourceHint}`
      : this.generateCommentGuide(brandName, `${scene} ${sourceHint}`.trim())

    const hashtags = this.buildHashtags(brandName, toneKeywords, blueWordResult.blueWords)

    await this.recordCopyHistory({
      orgId: brand?.orgId?.toString(),
      taskId: typeof metadata['taskId'] === 'string' ? metadata['taskId'] : null,
      title: blueWordResult.title,
      subtitle,
      hashtags,
      blueWords: blueWordResult.blueWords,
      commentGuide,
    })

    return {
      title: blueWordResult.title,
      subtitle,
      hashtags,
      commentGuide,
    }
  }

  generateBlueWords(title: string, keywords: string[] = []) {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      throw new BadRequestException('title is required')
    }

    const keywordBlueWords = keywords
      .map(keyword => keyword.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map(keyword => this.toBlueWord(keyword))
    const existingBlueWords = normalizedTitle.match(/#[^\s#]+/g) || []
    const blueWords = [...new Set([...existingBlueWords, ...keywordBlueWords])].slice(0, 3)
    const missingBlueWords = blueWords.filter(word => !normalizedTitle.includes(word))

    return {
      title: missingBlueWords.length > 0
        ? `${normalizedTitle} ${missingBlueWords.join(' ')}`
        : normalizedTitle,
      blueWords,
    }
  }

  generateCommentGuide(brand: string, content: string) {
    const safeBrand = brand.trim() || 'MediaClaw'
    const safeContent = content.trim() || '这条内容'
    return `${safeBrand}这条内容更适合哪种场景？评论区回复“模板”或“想看”，我按 ${safeContent} 继续补完整拆解。`
  }

  generateABVariants(baseTitle: string, count = 3) {
    const normalizedTitle = baseTitle.trim()
    if (!normalizedTitle) {
      throw new BadRequestException('baseTitle is required')
    }

    const normalizedCount = Math.min(Math.max(Math.trunc(Number(count) || 3), 1), 10)
    const candidates = [
      `${normalizedTitle}，看完就能直接复用`,
      `为什么说${normalizedTitle}更容易起量`,
      `${normalizedTitle}，评论区领拆解模板`,
      `${normalizedTitle}，3 步抄到可发布版本`,
      `${normalizedTitle}，品牌号也能这样写`,
    ]

    return [...new Set(candidates)].slice(0, normalizedCount)
  }

  async checkDedupHistory(orgId: string, content: string | { title?: string, subtitle?: string }) {
    if (!Types.ObjectId.isValid(orgId)) {
      return {
        isDuplicate: false,
        matchCount: 0,
        matches: [],
      }
    }

    const normalizedContent = typeof content === 'string'
      ? content.trim()
      : [content.title, content.subtitle].filter(Boolean).join(' ').trim()

    if (!normalizedContent) {
      return {
        isDuplicate: false,
        matchCount: 0,
        matches: [],
      }
    }

    const exactMatches = await this.copyHistoryModel.find({
      orgId: new Types.ObjectId(orgId),
      title: new RegExp(`^${this.escapeRegex(normalizedContent)}$`, 'i'),
    }).limit(5).lean().exec()

    const textMatches = await this.copyHistoryModel.find({
      orgId: new Types.ObjectId(orgId),
      $text: { $search: normalizedContent.replace(/#/g, ' ') },
    }).limit(5).lean().exec()

    const matches = [...exactMatches, ...textMatches]
      .filter((item, index, self) =>
        self.findIndex(candidate => candidate._id.toString() === item._id.toString()) === index,
      )
      .map(item => ({
        id: item._id.toString(),
        taskId: item.taskId?.toString() || null,
        title: item.title,
        subtitle: item.subtitle,
        createdAt: item.createdAt,
      }))

    return {
      isDuplicate: matches.length > 0,
      matchCount: matches.length,
      matches,
    }
  }

  private buildHashtags(brandName: string, keywords: string[], blueWords: string[]) {
    return [...new Set([
      this.toBlueWord(brandName.replace(/\s+/g, '')),
      ...keywords.slice(0, 3).map(keyword => this.toBlueWord(keyword)),
      ...blueWords,
    ])]
  }

  private toBlueWord(value: string) {
    const normalizedValue = value.replace(/^#+/, '').replace(/\s+/g, '')
    return normalizedValue ? `#${normalizedValue}` : ''
  }

  private async recordCopyHistory(payload: CopyHistoryPayload) {
    if (!payload.orgId || !Types.ObjectId.isValid(payload.orgId)) {
      return
    }

    const baseDocument = {
      orgId: new Types.ObjectId(payload.orgId),
      taskId: payload.taskId && Types.ObjectId.isValid(payload.taskId)
        ? new Types.ObjectId(payload.taskId)
        : null,
      title: payload.title,
      subtitle: payload.subtitle,
      hashtags: payload.hashtags,
      blueWords: payload.blueWords,
      commentGuide: payload.commentGuide,
      performance: {
        views: 0,
        clicks: 0,
        ctr: 0,
      },
    }

    if (baseDocument.taskId) {
      await this.copyHistoryModel.findOneAndUpdate(
        { taskId: baseDocument.taskId },
        { $set: baseDocument },
        { upsert: true, new: true },
      ).exec()
      return
    }

    await this.copyHistoryModel.create(baseDocument)
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
