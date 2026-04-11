import { createZodDto, PaginationDtoSchema } from '@yikart/common'
import { z } from 'zod'

const JsonRecordSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown())

export const InvokeAgentDtoSchema = z.object({
  prompt: z.string().min(1).max(4000).describe('用户任务描述'),
  payload: JsonRecordSchema.default({}).describe('结构化输入负载'),
  targetVersion: z.string().min(1).optional().describe('强制指定 agent 版本'),
})
export class InvokeAgentDto extends createZodDto(InvokeAgentDtoSchema, 'InvokeAgentDto') {}

export const ListAgentLogsDtoSchema = PaginationDtoSchema.extend({
  status: z.enum(['running', 'success', 'failed']).optional().describe('日志状态过滤'),
})
export class ListAgentLogsDto extends createZodDto(ListAgentLogsDtoSchema, 'ListAgentLogsDto') {}
