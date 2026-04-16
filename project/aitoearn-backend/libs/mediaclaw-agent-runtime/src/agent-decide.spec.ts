import type { ToolResponseMeta } from '@yikart/mediaclaw-shared-kernel'
import type { AgentContext } from './agent-context'
import { TaskState } from '@yikart/mediaclaw-shared-kernel'
import { describe, expect, it } from 'vitest'
import { agentDecide } from './agent-decide'

function createContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    currentState: TaskState.PRODUCING,
    retryCount: 0,
    routeSwitchCount: 0,
    productionMode: 'production',
    inputReady: true,
    qaScore: 80,
    unique: true,
    compliant: true,
    confidence: 0.9,
    currentCostYuan: 5,
    estimatedCostYuan: 10,
    customerConfirmedOverBudget: false,
    employeeConfirmed: false,
    hasPlatformEvidenceUrl: false,
    cancelRequested: false,
    takedownReported: false,
    ...overrides,
  }
}

function createResult(overrides: Partial<ToolResponseMeta> = {}): ToolResponseMeta {
  return {
    status: 'success',
    errorCode: 'NONE',
    retryable: true,
    confidence: 0.9,
    costYuan: 1.2,
    humanReviewRequired: false,
    sideEffects: [],
    ...overrides,
  }
}

describe('agentDecide', () => {
  it('应在 qa_score≥70 且 unique/compliant 成立时进入 QA_PASSED', () => {
    const action = agentDecide(
      createResult(),
      createContext({
        currentState: TaskState.PRODUCING,
        qaScore: 72,
        unique: true,
        compliant: true,
        confidence: 0.88,
      }),
    )

    expect(action).toMatchObject({
      type: 'TRANSITION_STATE',
      nextState: TaskState.QA_PASSED,
    })
  })

  it('应在 qa_score<70 且 retry≤3 时继续重试', () => {
    const action = agentDecide(
      createResult({
        status: 'failed',
        errorCode: 'QA_FAIL',
      }),
      createContext({
        qaScore: 68,
        retryCount: 2,
        currentToolId: 'qa-optimizer',
      }),
    )

    expect(action).toMatchObject({
      type: 'RETRY_SAME_TOOL',
    })
  })

  it('应在 retry>3 时挂起任务', () => {
    const action = agentDecide(
      createResult({
        status: 'failed',
        errorCode: 'QA_FAIL',
      }),
      createContext({
        currentState: TaskState.QA_FAILED,
        qaScore: 62,
        retryCount: 3,
        unique: true,
        compliant: true,
      }),
    )

    expect(action).toMatchObject({
      type: 'SUSPEND_TASK',
      nextState: TaskState.SUSPENDED,
    })
  })

  it('应在 confidence<0.7 时追加二次校验', () => {
    const action = agentDecide(
      createResult({
        status: 'partial',
        errorCode: 'LOW_CONFIDENCE',
        confidence: 0.62,
      }),
      createContext({
        confidence: 0.62,
      }),
    )

    expect(action).toMatchObject({
      type: 'CALL_VALIDATOR',
      nextToolId: 'replacement-validator',
    })
  })

  it('应在 CONTENT_VIOLATION 时通知客户', () => {
    const action = agentDecide(
      createResult({
        status: 'failed',
        errorCode: 'CONTENT_VIOLATION',
        retryable: false,
      }),
      createContext(),
    )

    expect(action).toMatchObject({
      type: 'NOTIFY_CUSTOMER',
    })
  })

  it('应在成本超预期 1.5x 时请求客户确认', () => {
    const action = agentDecide(
      createResult({
        status: 'success',
        errorCode: 'NONE',
      }),
      createContext({
        currentCostYuan: 16,
        estimatedCostYuan: 10,
        customerConfirmedOverBudget: false,
      }),
    )

    expect(action).toMatchObject({
      type: 'REQUEST_CONFIRMATION',
    })
  })
})
