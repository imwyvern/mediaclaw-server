import { createPaginationVo, createZodDto } from '@yikart/common'
import { z } from 'zod'

const JsonRecordSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown())

export const ProductAgentExecutionConfigVoSchema = z.object({
  model: z.string(),
  maxBudgetUsd: z.number(),
  timeoutMs: z.number(),
})

export const ProductAgentStageStepVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  promptTemplate: z.string(),
  outputKey: z.string().optional(),
  serverNames: z.array(z.string()),
})

export const ProductAgentStageVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(['serial', 'parallel', 'conditional']),
  condition: z.object({
    source: z.enum(['input', 'context']),
    path: z.string(),
    operator: z.enum(['exists', 'equals', 'includes']),
    value: z.unknown().optional(),
  }).nullable().optional(),
  steps: z.array(ProductAgentStageStepVoSchema),
})

export const ProductAgentVoSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  capabilities: z.array(z.string()),
  tags: z.array(z.string()),
  defaultVersion: z.string(),
  availableVersions: z.array(z.string()),
  rolloutStrategy: z.string(),
  rolloutTargets: z.array(z.object({
    version: z.string(),
    weight: z.number(),
    label: z.string(),
  })),
  schema: z.object({
    input: JsonRecordSchema,
    output: JsonRecordSchema,
  }),
  execution: ProductAgentExecutionConfigVoSchema,
  stages: z.array(ProductAgentStageVoSchema),
  metadata: JsonRecordSchema,
})
export class ProductAgentVo extends createZodDto(ProductAgentVoSchema, 'ProductAgentVo') {}

export const ProductAgentListVoSchema = z.object({
  items: z.array(ProductAgentVoSchema),
})
export class ProductAgentListVo extends createZodDto(ProductAgentListVoSchema, 'ProductAgentListVo') {
  static from(items: Array<z.infer<typeof ProductAgentVoSchema>>) {
    return ProductAgentListVo.create({ items })
  }
}

export const ProductAgentStepTraceVoSchema = z.object({
  stageId: z.string(),
  stepId: z.string(),
  role: z.string(),
  status: z.enum(['success', 'failed', 'skipped']),
  latencyMs: z.number(),
  conditionMatched: z.boolean(),
  input: JsonRecordSchema,
  output: JsonRecordSchema,
  errorMessage: z.string().optional(),
  tokenUsage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheCreationInputTokens: z.number(),
    cacheReadInputTokens: z.number(),
    totalTokens: z.number(),
  }),
  costUsd: z.number(),
})

export const ProductAgentInvokeVoSchema = z.object({
  invocationId: z.string(),
  agentId: z.string(),
  version: z.string(),
  variantLabel: z.string(),
  latencyMs: z.number(),
  costUsd: z.number(),
  tokenUsage: ProductAgentStepTraceVoSchema.shape.tokenUsage,
  output: JsonRecordSchema,
  trace: z.array(ProductAgentStepTraceVoSchema),
})
export class ProductAgentInvokeVo extends createZodDto(ProductAgentInvokeVoSchema, 'ProductAgentInvokeVo') {}

export const ProductAgentLogItemVoSchema = z.object({
  invocationId: z.string(),
  agentId: z.string(),
  version: z.string(),
  status: z.enum(['running', 'success', 'failed']),
  latencyMs: z.number(),
  costUsd: z.number(),
  tokenUsage: ProductAgentStepTraceVoSchema.shape.tokenUsage,
  input: JsonRecordSchema,
  output: JsonRecordSchema,
  trace: z.array(ProductAgentStepTraceVoSchema),
  errorMessage: z.string().optional(),
  metadata: JsonRecordSchema,
  createdAt: z.coerce.date(),
})
export class ProductAgentLogItemVo extends createZodDto(ProductAgentLogItemVoSchema, 'ProductAgentLogItemVo') {}

export class ProductAgentLogListVo extends createPaginationVo(ProductAgentLogItemVoSchema, 'ProductAgentLogListVo') {}
