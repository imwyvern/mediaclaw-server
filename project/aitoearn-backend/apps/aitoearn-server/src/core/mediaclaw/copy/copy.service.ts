import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Brand } from '@yikart/mongodb'

export interface GeneratedCopy {
  title: string
  subtitle: string
  hashtags: string[]
  commentGuide: string
}

@Injectable()
export class CopyService {
  constructor(
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
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

    // TODO: 接入 DeepSeek API，基于品牌资产和视频分析结果生成正式文案。
    return {
      title: `${brandName}${primaryTone}短视频`,
      subtitle: `${scene}场景成片已生成，突出${toneKeywords.slice(0, 2).join('、') || '品牌识别度'}`,
      hashtags: [
        `#${brandName.replace(/\s+/g, '')}`,
        ...toneKeywords.slice(0, 3).map(keyword => `#${keyword.replace(/\s+/g, '')}`),
      ],
      commentGuide: avoidKeywords.length > 0
        ? `评论区建议引导体验和反馈，避免提及：${avoidKeywords.join('、')}。${sourceHint}`
        : `评论区建议引导用户描述使用感受、应用场景和下一步需求。${sourceHint}`,
    }
  }
}
