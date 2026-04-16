import type { ToolId, ToolResponseMeta } from '@yikart/mediaclaw-shared-kernel'
import type { AgentContext } from './agent-context'
import { TaskState } from '@yikart/mediaclaw-shared-kernel'

/**
 * Agent 动作类型
 */
export type AgentActionType
  = | 'START_PIPELINE'
    | 'RETRY_SAME_TOOL'
    | 'RETRY_WITH_FALLBACK_ROUTE'
    | 'CALL_VALIDATOR'
    | 'CALL_STYLE_REWRITER'
    | 'CALL_VIDEO_EDITOR'
    | 'REQUEST_INPUT'
    | 'REQUEST_CONFIRMATION'
    | 'NOTIFY_CUSTOMER'
    | 'NOTIFY_ADMIN'
    | 'DISPATCH_TO_EMPLOYEE'
    | 'TRANSITION_STATE'
    | 'CAPTURE_BILLING'
    | 'START_REFUND_REVIEW'
    | 'SUSPEND_TASK'
    | 'CANCEL_TASK'
    | 'NO_OP'

/**
 * Agent 动作
 */
export interface AgentAction {
  /**
   * 动作类型，必填
   */
  type: AgentActionType
  /**
   * 下一个状态，可选
   */
  nextState?: TaskState
  /**
   * 后续调用 Tool，可选
   */
  nextToolId?: ToolId
  /**
   * 解释原因，必填
   */
  reason: string
}

/**
 * Agent 决策函数
 */
export function agentDecide(result: ToolResponseMeta, ctx: AgentContext): AgentAction {
  if (ctx.cancelRequested && ctx.currentState !== TaskState.BILLABLE) {
    return {
      type: 'CANCEL_TASK',
      nextState: TaskState.CANCELLED,
      reason: '收到客户撤单请求且任务尚未入账',
    }
  }

  if (!ctx.inputReady || result.errorCode === 'INPUT_MISSING' || result.errorCode === 'VALIDATION_FAILED') {
    return {
      type: 'REQUEST_INPUT',
      reason: '输入缺失或校验失败，Agent 必须补齐输入后再继续',
    }
  }

  if (ctx.takedownReported || result.errorCode === 'TAKEDOWN_REPORTED') {
    return {
      type: 'START_REFUND_REVIEW',
      nextState: TaskState.REFUND_REVIEW,
      reason: '平台已下架，必须进入退款审核流程',
    }
  }

  if (ctx.currentState === TaskState.DISPATCH_TIMEOUT || result.errorCode === 'DISPATCH_TIMEOUT') {
    if ((ctx.dispatchTimeoutHours ?? 72) >= 72) {
      return {
        type: 'NOTIFY_ADMIN',
        nextState: TaskState.ESCALATED,
        reason: '员工 72 小时未确认，升级管理员',
      }
    }

    return {
      type: 'NO_OP',
      reason: '分发已超时但尚未达到升级阈值，保持催办与轮询',
    }
  }

  if (result.humanReviewRequired) {
    return {
      type: 'REQUEST_CONFIRMATION',
      reason: 'Tool 要求人工确认，Agent 必须挂起等待客户输入',
    }
  }

  if (result.errorCode === 'CONTENT_VIOLATION') {
    return {
      type: 'NOTIFY_CUSTOMER',
      reason: '素材或文案触发合规风险，必须让客户换素材或改文案',
    }
  }

  if (result.errorCode === 'RATE_LIMIT' || result.errorCode === 'TIMEOUT' || result.errorCode === 'API_DOWN') {
    if (ctx.routeSwitchCount < 2 && result.retryable) {
      return {
        type: 'RETRY_WITH_FALLBACK_ROUTE',
        reason: '基础设施错误，优先切换路由重试',
      }
    }

    if (ctx.retryCount < 3 && result.retryable) {
      return {
        type: 'RETRY_SAME_TOOL',
        reason: '路由已切换但仍失败，继续在当前 Tool 维持自动重试',
      }
    }

    return {
      type: 'SUSPEND_TASK',
      nextState: TaskState.SUSPENDED,
      reason: '基础设施错误超过自动恢复阈值，挂起等待人工处理',
    }
  }

  if (result.errorCode === 'UNKNOWN') {
    return {
      type: 'SUSPEND_TASK',
      nextState: TaskState.SUSPENDED,
      reason: '未知错误不可直接信任，挂起并等待人工排查',
    }
  }

  if (result.errorCode === 'BUDGET_EXCEEDED' || ctx.currentCostYuan > ctx.estimatedCostYuan * 1.5) {
    if (!ctx.customerConfirmedOverBudget) {
      return {
        type: 'REQUEST_CONFIRMATION',
        reason: '成本超过预估 1.5 倍，必须先获得客户确认',
      }
    }
  }

  if (result.errorCode === 'LOW_CONFIDENCE' || (ctx.confidence ?? result.confidence) < 0.7) {
    return {
      type: 'CALL_VALIDATOR',
      nextToolId: 'replacement-validator',
      reason: '置信度不足，必须追加二次校验',
    }
  }

  if (result.errorCode === 'DEDUP_FAIL' || ctx.unique === false) {
    return {
      type: 'CALL_STYLE_REWRITER',
      nextToolId: 'style-rewriter',
      reason: '查重未通过，必须做风格变异后重检',
    }
  }

  if (ctx.compliant === false) {
    return {
      type: 'NOTIFY_CUSTOMER',
      reason: '合规未通过，Agent 直接通知客户替换素材或修改文案',
    }
  }

  if ((ctx.qaScore ?? 0) < 70 || result.errorCode === 'QA_FAIL') {
    if (ctx.retryCount < 3) {
      if (ctx.currentToolId === 'video-generator') {
        return {
          type: 'RETRY_WITH_FALLBACK_ROUTE',
          reason: 'QA 不过且当前环节是生成器，优先切模型/切路由重跑',
        }
      }

      if (ctx.currentToolId === 'final-composer' || ctx.currentToolId === 'video-editor') {
        return {
          type: 'CALL_VIDEO_EDITOR',
          nextToolId: 'video-editor',
          reason: 'QA 不过且可局部修复，进入最小重跑编辑流',
        }
      }

      return {
        type: 'RETRY_SAME_TOOL',
        reason: 'QA 不过但仍在自动重试阈值内，继续重试',
      }
    }

    return {
      type: 'SUSPEND_TASK',
      nextState: TaskState.SUSPENDED,
      reason: 'QA 连续 3 次不过，挂起并要求客户补素材',
    }
  }

  if (
    result.errorCode === 'NONE'
    && result.status === 'success'
    && ctx.currentState === TaskState.PRODUCING
    && (ctx.qaScore ?? 0) >= 70
    && (ctx.confidence ?? result.confidence) >= 0.7
  ) {
    return {
      type: 'TRANSITION_STATE',
      nextState: TaskState.QA_PASSED,
      reason: '当前结果无错误且质量、查重、合规、置信度全部达标，进入待分发状态',
    }
  }

  if (ctx.currentState === TaskState.CREATED) {
    return {
      type: 'START_PIPELINE',
      nextState: TaskState.PRODUCING,
      reason: '任务已创建且输入齐全，启动主管线',
    }
  }

  if (ctx.currentState === TaskState.QA_PASSED) {
    return {
      type: 'DISPATCH_TO_EMPLOYEE',
      nextState: TaskState.DISPATCHED,
      reason: '合格成品已准备完成，必须先分发给员工发布',
    }
  }

  if (
    ctx.currentState === TaskState.PUBLISHED
    && (ctx.employeeConfirmed || ctx.hasPlatformEvidenceUrl)
  ) {
    return {
      type: 'CAPTURE_BILLING',
      nextState: TaskState.BILLABLE,
      reason: '已发布且已有可审计凭证，允许扣费',
    }
  }

  if (ctx.currentState === TaskState.BILLABLE) {
    return {
      type: 'NO_OP',
      reason: '已入账，等待效果回收链路执行',
    }
  }

  return {
    type: 'NO_OP',
    reason: '当前状态无需额外动作，保持轮询',
  }
}
