import { createZodDto } from '@yikart/common'
import { z } from 'zod'

// === 通用 schemas ===

export const MediaclawPlatformSchema = z.enum(['douyin', 'xhs', 'kuaishou', 'bilibili'])

export const VideoModelSchema = z.enum(['seedance-2.0', 'seedance-1.5', 'kling', 'remotion'])

export const BrandProfileSchema = z.object({
  brandId: z.string(),
  brandName: z.string(),
  industry: z.string(),
})
export type BrandProfileDtoData = z.infer<typeof BrandProfileSchema>

export const ProductProfileSchema = z.object({
  productId: z.string(),
  name: z.string(),
  features: z.array(z.string()),
  images: z.array(z.string()),
})
export type ProductProfileDtoData = z.infer<typeof ProductProfileSchema>

export const ScriptLineSchema = z.object({
  lineId: z.string(),
  text: z.string(),
  durationSec: z.number(),
})
export type ScriptLineDtoData = z.infer<typeof ScriptLineSchema>

export const SceneCutSchema = z.object({
  cutId: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  motionType: z.string().optional(),
  motionPrompt: z.string().optional(),
})
export type SceneCutDtoData = z.infer<typeof SceneCutSchema>

export const ModelAllocationSchema = z.object({
  cutId: z.string(),
  model: VideoModelSchema,
  reason: z.string(),
})
export type ModelAllocationDtoData = z.infer<typeof ModelAllocationSchema>

export const RemixBriefSchema = z.object({
  totalDurationSec: z.number(),
  cuts: z.array(SceneCutSchema),
  script: z.array(ScriptLineSchema),
  modelAllocation: z.array(ModelAllocationSchema),
  estimatedCostYuan: z.number(),
  estimatedTimeMin: z.number(),
})
export type RemixBriefData = z.infer<typeof RemixBriefSchema>

export const ImageRefSchema = z.object({
  assetId: z.string(),
  storageKey: z.string(),
  url: z.string().optional(),
  sha256: z.string(),
  mimeType: z.string(),
  width: z.number(),
  height: z.number(),
})
export type ImageRefDtoData = z.infer<typeof ImageRefSchema>

export type MediaclawPlatform = z.infer<typeof MediaclawPlatformSchema>

// === Pipeline DTOs ===

export const ProductShowcaseDtoSchema = z.object({
  brief: RemixBriefSchema,
  targetBrand: BrandProfileSchema,
  targetProduct: ProductProfileSchema,
  qualityLevel: z.enum(['standard', 'premium']),
})
export class ProductShowcaseDto extends createZodDto(ProductShowcaseDtoSchema) {}
export type ProductShowcaseDtoData = z.infer<typeof ProductShowcaseDtoSchema>

export const AiLiveDtoSchema = z.object({
  productImages: z.array(ImageRefSchema).min(1),
  style: z.string(),
  durationSec: z.number().min(2).max(60),
})
export class AiLiveDto extends createZodDto(AiLiveDtoSchema) {}
export type AiLiveDtoData = z.infer<typeof AiLiveDtoSchema>

export const ExplainerDtoSchema = z.object({
  product: ProductProfileSchema,
  templateId: z.string(),
  durationSec: z.number().min(5).max(120),
})
export class ExplainerDto extends createZodDto(ExplainerDtoSchema) {}
export type ExplainerDtoData = z.infer<typeof ExplainerDtoSchema>

// === Tool DTOs ===

export const RemixBriefDtoSchema = z.object({
  referenceUrl: z.string().url(),
  targetBrand: BrandProfileSchema,
  targetProduct: ProductProfileSchema,
})
export class RemixBriefDto extends createZodDto(RemixBriefDtoSchema) {}
export type CreateRemixBriefDtoData = z.infer<typeof RemixBriefDtoSchema>

export const TrendingScoutDtoSchema = z.object({
  mode: z.enum(['discover', 'competitor']),
  category: z.string().optional(),
  platform: MediaclawPlatformSchema.optional(),
  days: z.number().optional(),
  limit: z.number().optional(),
  competitorAccounts: z.array(z.string()).optional(),
})
export class TrendingScoutDto extends createZodDto(TrendingScoutDtoSchema) {}
export type TrendingScoutDtoData = z.infer<typeof TrendingScoutDtoSchema>

export const ContentPlannerDtoSchema = z.object({
  brand: BrandProfileSchema,
  products: z.array(ProductProfileSchema).min(1),
  recentPerformance: z.array(
    z.object({
      contentType: z.string(),
      avgViews: z.number(),
      avgEngagementRate: z.number(),
    }),
  ),
  budgetRemaining: z.number(),
  competitorReport: z
    .object({
      newVideos: z.array(
        z.object({
          url: z.string(),
          postedAt: z.string(),
          performance: z.object({
            views: z.number().optional(),
            likes: z.number().optional(),
            comments: z.number().optional(),
          }),
        }),
      ),
      styleTrends: z.array(z.string()),
      opportunity: z.string(),
    })
    .optional(),
  postsPerWeek: z.number().optional(),
})
export class ContentPlannerDto extends createZodDto(ContentPlannerDtoSchema) {}
export type ContentPlannerDtoData = z.infer<typeof ContentPlannerDtoSchema>

export const PlatformPackagerDtoSchema = z.object({
  videoAssetId: z.string(),
  platform: MediaclawPlatformSchema,
  brand: BrandProfileSchema,
  product: ProductProfileSchema,
})
export class PlatformPackagerDto extends createZodDto(PlatformPackagerDtoSchema) {}
export type PlatformPackagerDtoData = z.infer<typeof PlatformPackagerDtoSchema>
