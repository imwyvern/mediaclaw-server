import { createZodDto } from '@yikart/common'
import { z } from 'zod'

// === 通用 schemas ===

const BrandProfileSchema = z.object({
  brandId: z.string(),
  brandName: z.string(),
  industry: z.string(),
})

const ProductProfileSchema = z.object({
  productId: z.string(),
  name: z.string(),
  features: z.array(z.string()),
  images: z.array(z.string()),
})

const ScriptLineSchema = z.object({
  lineId: z.string(),
  text: z.string(),
  durationSec: z.number(),
})

const SceneCutSchema = z.object({
  cutId: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  motionType: z.string().optional(),
  motionPrompt: z.string().optional(),
})

const ModelAllocationSchema = z.object({
  cutId: z.string(),
  model: z.enum(['seedance-2.0', 'seedance-1.5', 'kling', 'remotion']),
  reason: z.string(),
})

const RemixBriefSchema = z.object({
  totalDurationSec: z.number(),
  cuts: z.array(SceneCutSchema),
  script: z.array(ScriptLineSchema),
  modelAllocation: z.array(ModelAllocationSchema),
  estimatedCostYuan: z.number(),
  estimatedTimeMin: z.number(),
})

const ImageRefSchema = z.object({
  assetId: z.string(),
  storageKey: z.string(),
  url: z.string().optional(),
  sha256: z.string(),
  mimeType: z.string(),
  width: z.number(),
  height: z.number(),
})

// === Pipeline DTOs ===

export const ProductShowcaseDtoSchema = z.object({
  brief: RemixBriefSchema,
  targetBrand: BrandProfileSchema,
  targetProduct: ProductProfileSchema,
  qualityLevel: z.enum(['standard', 'premium']),
})
export class ProductShowcaseDto extends createZodDto(ProductShowcaseDtoSchema) {}

export const AiLiveDtoSchema = z.object({
  productImages: z.array(ImageRefSchema).min(1),
  style: z.string(),
  durationSec: z.number().min(2).max(60),
})
export class AiLiveDto extends createZodDto(AiLiveDtoSchema) {}

export const ExplainerDtoSchema = z.object({
  product: ProductProfileSchema,
  templateId: z.string(),
  durationSec: z.number().min(5).max(120),
})
export class ExplainerDto extends createZodDto(ExplainerDtoSchema) {}

// === Tool DTOs ===

export const RemixBriefDtoSchema = z.object({
  referenceUrl: z.string().url(),
  targetBrand: BrandProfileSchema,
  targetProduct: ProductProfileSchema,
})
export class RemixBriefDto extends createZodDto(RemixBriefDtoSchema) {}

export const TrendingScoutDtoSchema = z.object({
  mode: z.enum(['discover', 'competitor']),
  category: z.string().optional(),
  platform: z.enum(['douyin', 'xhs', 'kuaishou', 'bilibili']).optional(),
  days: z.number().optional(),
  limit: z.number().optional(),
  competitorAccounts: z.array(z.string()).optional(),
})
export class TrendingScoutDto extends createZodDto(TrendingScoutDtoSchema) {}

export const ContentPlannerDtoSchema = z.object({
  brand: BrandProfileSchema,
  products: z.array(ProductProfileSchema).min(1),
  recentPerformance: z.array(z.object({
    contentType: z.string(),
    avgViews: z.number(),
    avgEngagementRate: z.number(),
  })),
  budgetRemaining: z.number(),
})
export class ContentPlannerDto extends createZodDto(ContentPlannerDtoSchema) {}

export const PlatformPackagerDtoSchema = z.object({
  videoAssetId: z.string(),
  platform: z.enum(['douyin', 'xhs', 'kuaishou', 'bilibili']),
  brand: BrandProfileSchema,
  product: ProductProfileSchema,
})
export class PlatformPackagerDto extends createZodDto(PlatformPackagerDtoSchema) {}
