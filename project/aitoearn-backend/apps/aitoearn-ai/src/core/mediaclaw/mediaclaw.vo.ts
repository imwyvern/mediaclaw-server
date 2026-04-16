import { createZodDto } from '@yikart/common'
import { z } from 'zod'

// === 通用 schemas ===

const VideoAssetRefSchema = z.object({
  assetId: z.string(),
  storageKey: z.string(),
  url: z.string().optional(),
  sha256: z.string(),
  mimeType: z.string(),
  durationSec: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  hasAudio: z.boolean(),
})

const CostBreakdownSchema = z.object({
  replacement: z.number().optional(),
  generation: z.number().optional(),
  tts: z.number().optional(),
  compose: z.number().optional(),
  total: z.number(),
})

const QualityReportSchema = z.object({
  qaScore: z.number(),
  passed: z.boolean(),
  issues: z.array(z.object({
    type: z.string(),
    message: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
  })),
})

// === Pipeline VOs ===

export const PipelineResultVoSchema = z.object({
  finalVideo: VideoAssetRefSchema,
  costBreakdown: CostBreakdownSchema,
  qualityReport: QualityReportSchema,
  state: z.enum(['PRODUCING', 'QA_PASSED', 'SUSPENDED']),
})
export class PipelineResultVo extends createZodDto(PipelineResultVoSchema) {}

// === Tool VOs ===

export const RemixBriefVoSchema = z.object({
  brief: z.object({
    totalDurationSec: z.number(),
    cuts: z.array(z.any()),
    script: z.array(z.any()),
    modelAllocation: z.array(z.any()),
    estimatedCostYuan: z.number(),
    estimatedTimeMin: z.number(),
  }),
})
export class RemixBriefVo extends createZodDto(RemixBriefVoSchema) {}

export const TrendingScoutVoSchema = z.object({
  videos: z.array(z.object({
    url: z.string(),
    title: z.string(),
    likes: z.number().optional(),
    shares: z.number().optional(),
    styleTags: z.array(z.string()).optional(),
  })).optional(),
  competitorReport: z.object({
    newVideos: z.array(z.any()),
    styleTrends: z.array(z.string()),
    opportunity: z.string(),
  }).optional(),
})
export class TrendingScoutVo extends createZodDto(TrendingScoutVoSchema) {}

export const ContentPlannerVoSchema = z.object({
  weeklyPlan: z.array(z.object({
    day: z.string(),
    contentType: z.string(),
    platform: z.string(),
    reason: z.string(),
    referenceUrl: z.string().optional(),
  })),
  monthlyCalendarSummary: z.string().optional(),
})
export class ContentPlannerVo extends createZodDto(ContentPlannerVoSchema) {}

export const PlatformPackagerVoSchema = z.object({
  title: z.string(),
  coverImage: z.object({
    assetId: z.string(),
    storageKey: z.string(),
    url: z.string().optional(),
  }),
  hashtags: z.array(z.string()),
  description: z.string(),
  complianceCheck: z.object({
    passed: z.boolean(),
    warnings: z.array(z.string()),
    violations: z.array(z.string()),
  }),
})
export class PlatformPackagerVo extends createZodDto(PlatformPackagerVoSchema) {}

export const PerformanceInsightVoSchema = z.object({
  realtime: z.object({
    videoId: z.string(),
    platform: z.string(),
    metrics: z.object({
      views: z.number(),
      likes: z.number(),
      comments: z.number(),
      shares: z.number(),
      saves: z.number().optional(),
    }),
    benchmark: z.string(),
    diagnosis: z.string(),
    actionSuggestion: z.string(),
  }).optional(),
  monthly: z.object({
    period: z.string(),
    summary: z.string(),
    savings: z.string(),
    bestType: z.string(),
    recommendation: z.string(),
  }).optional(),
})
export class PerformanceInsightVo extends createZodDto(PerformanceInsightVoSchema) {}
