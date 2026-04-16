import { describe, expect, it } from 'vitest'
import { TaskEvent, TaskState } from './enums'
import { transition } from './state-machine'

describe('stateMachine', () => {
  it('应按主流程完成 CREATED 到 BILLABLE 的状态流转', () => {
    let currentState = TaskState.CREATED

    currentState = transition(currentState, TaskEvent.START_PRODUCING)
    expect(currentState).toBe(TaskState.PRODUCING)

    currentState = transition(currentState, TaskEvent.QA_PASS)
    expect(currentState).toBe(TaskState.QA_PASSED)

    currentState = transition(currentState, TaskEvent.DISPATCH)
    expect(currentState).toBe(TaskState.DISPATCHED)

    currentState = transition(currentState, TaskEvent.PUBLISH_CONFIRMED)
    expect(currentState).toBe(TaskState.PUBLISHED)

    currentState = transition(currentState, TaskEvent.CAPTURE_BILLING)
    expect(currentState).toBe(TaskState.BILLABLE)
  })

  it('应在 QA 连续 3 次失败后进入 SUSPENDED', () => {
    let currentState = TaskState.CREATED

    currentState = transition(currentState, TaskEvent.START_PRODUCING)
    expect(currentState).toBe(TaskState.PRODUCING)

    currentState = transition(currentState, TaskEvent.QA_FAIL)
    expect(currentState).toBe(TaskState.QA_FAILED)

    currentState = transition(currentState, TaskEvent.RETRY_AFTER_QA_FAIL)
    expect(currentState).toBe(TaskState.EDITING)

    currentState = transition(currentState, TaskEvent.EDIT_COMPLETE)
    expect(currentState).toBe(TaskState.PRODUCING)

    currentState = transition(currentState, TaskEvent.QA_FAIL)
    expect(currentState).toBe(TaskState.QA_FAILED)

    currentState = transition(currentState, TaskEvent.RETRY_AFTER_QA_FAIL)
    expect(currentState).toBe(TaskState.EDITING)

    currentState = transition(currentState, TaskEvent.EDIT_COMPLETE)
    expect(currentState).toBe(TaskState.PRODUCING)

    currentState = transition(currentState, TaskEvent.QA_FAIL)
    expect(currentState).toBe(TaskState.QA_FAILED)

    currentState = transition(currentState, TaskEvent.EXHAUST_RETRIES)
    expect(currentState).toBe(TaskState.SUSPENDED)
  })

  it('应允许所有 BILLABLE 之前的可取消状态进入 CANCELLED', () => {
    const cancellableStates = [
      TaskState.CREATED,
      TaskState.PRODUCING,
      TaskState.QA_FAILED,
      TaskState.QA_PASSED,
      TaskState.DISPATCHED,
      TaskState.REJECTED,
      TaskState.EDITING,
      TaskState.PUBLISHED,
    ] satisfies TaskState[]

    for (const state of cancellableStates) {
      expect(transition(state, TaskEvent.CANCEL)).toBe(TaskState.CANCELLED)
    }
  })

  it('应在非法转换时抛出 Error', () => {
    expect(() => transition(TaskState.CREATED, TaskEvent.QA_PASS)).toThrowError(
      'Invalid transition: CREATED -> QA_PASS',
    )
  })
})
