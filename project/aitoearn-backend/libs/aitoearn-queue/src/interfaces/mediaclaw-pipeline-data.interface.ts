/**
 * MediaClaw 管线队列数据接口
 */
export interface MediaclawPipelineData {
  /** 管线类型 */
  pipelineType: 'product-showcase' | 'ai-live' | 'explainer'
  /** 管线输入参数 */
  input: Record<string, unknown>
  /** 用户 ID */
  userId: string
  /** 组织 ID */
  orgId: string
  /** 任务 ID（唯一） */
  taskId: string
  /** 创建时间 */
  createdAt: string
}
