import type { ToolId } from '@yikart/mediaclaw-shared-kernel'
import { TaskState } from '@yikart/mediaclaw-shared-kernel'

/**
 * Agent 当前上下文
 */
export interface AgentContext {
  /**
   * 当前状态，必填
   */
  currentState: TaskState
  /**
   * 当前 Tool，可选
   */
  currentToolId?: ToolId
  /**
   * 当前重试次数，必填
   */
  retryCount: number
  /**
   * 当前已切换路由次数，必填
   */
  routeSwitchCount: number
  /**
   * 生产阶段，必填
   */
  productionMode: 'trial' | 'production'
  /**
   * 输入是否完整，必填
   */
  inputReady: boolean
  /**
   * QA 分数，可选
   */
  qaScore?: number
  /**
   * 是否唯一，可选
   */
  unique?: boolean
  /**
   * 是否合规，可选
   */
  compliant?: boolean
  /**
   * 置信度，可选
   */
  confidence?: number
  /**
   * 本次累计成本，必填
   */
  currentCostYuan: number
  /**
   * 预估成本，必填
   */
  estimatedCostYuan: number
  /**
   * 是否已获得超预算确认，必填
   */
  customerConfirmedOverBudget: boolean
  /**
   * 是否已有员工确认，必填
   */
  employeeConfirmed: boolean
  /**
   * 是否已有平台可审计 URL，必填
   */
  hasPlatformEvidenceUrl: boolean
  /**
   * 派发超时小时数，可选
   */
  dispatchTimeoutHours?: number
  /**
   * 是否收到取消请求，必填
   */
  cancelRequested: boolean
  /**
   * 是否发生平台下架，必填
   */
  takedownReported: boolean
}
