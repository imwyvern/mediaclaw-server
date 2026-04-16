import { TaskEvent, TaskState } from './enums'

/**
 * 状态转换定义
 */
export interface StateTransition {
  /**
   * 来源状态
   */
  from: TaskState
  /**
   * 触发事件
   */
  event: TaskEvent
  /**
   * 目标状态
   */
  to: TaskState
  /**
   * 进入目标状态时的副作用
   */
  sideEffect?: string
}

/**
 * 合格成品判定
 */
export interface QualifiedArtifactRule {
  /**
   * QA 分数下限
   */
  minQaScore: 70
  /**
   * 必须查重通过
   */
  dedupUniqueRequired: true
  /**
   * 必须合规通过
   */
  compliancePassedRequired: true
}

/**
 * 统一状态转换表
 */
export const TRANSITIONS: StateTransition[] = [
  {
    from: TaskState.CREATED,
    event: TaskEvent.START_PRODUCING,
    to: TaskState.PRODUCING,
    sideEffect: '创建任务运行记录并启动管线',
  },
  {
    from: TaskState.PRODUCING,
    event: TaskEvent.QA_PASS,
    to: TaskState.QA_PASSED,
    sideEffect: '写入 QA 报告并冻结产物指纹',
  },
  {
    from: TaskState.PRODUCING,
    event: TaskEvent.QA_FAIL,
    to: TaskState.QA_FAILED,
    sideEffect: '累加 retry 计数并记录失败原因',
  },
  {
    from: TaskState.QA_FAILED,
    event: TaskEvent.RETRY_AFTER_QA_FAIL,
    to: TaskState.EDITING,
    sideEffect: '根据失败原因生成局部重跑计划',
  },
  {
    from: TaskState.EDITING,
    event: TaskEvent.EDIT_COMPLETE,
    to: TaskState.PRODUCING,
    sideEffect: '恢复主管线并重新触发 QA',
  },
  {
    from: TaskState.QA_FAILED,
    event: TaskEvent.EXHAUST_RETRIES,
    to: TaskState.SUSPENDED,
    sideEffect: '挂起任务并通知客户补素材',
  },
  {
    from: TaskState.QA_PASSED,
    event: TaskEvent.DISPATCH,
    to: TaskState.DISPATCHED,
    sideEffect: '生成飞书/企微卡片并推送员工',
  },
  {
    from: TaskState.DISPATCHED,
    event: TaskEvent.CUSTOMER_REJECT,
    to: TaskState.REJECTED,
    sideEffect: '结构化解析客户反馈并写入修改单',
  },
  {
    from: TaskState.REJECTED,
    event: TaskEvent.START_EDIT,
    to: TaskState.EDITING,
    sideEffect: '进入 video-editor 局部修改流程',
  },
  {
    from: TaskState.DISPATCHED,
    event: TaskEvent.PUBLISH_CONFIRMED,
    to: TaskState.PUBLISHED,
    sideEffect: '写入可审计发布凭证并启动效果回收倒计时',
  },
  {
    from: TaskState.PUBLISHED,
    event: TaskEvent.CAPTURE_BILLING,
    to: TaskState.BILLABLE,
    sideEffect: '扣减 1 条额度并写入 Cost Ledger',
  },
  {
    from: TaskState.DISPATCHED,
    event: TaskEvent.DISPATCH_TIMEOUT,
    to: TaskState.DISPATCH_TIMEOUT,
    sideEffect: '标记员工 72h 未确认并提醒管理员',
  },
  {
    from: TaskState.DISPATCH_TIMEOUT,
    event: TaskEvent.ESCALATE_TO_ADMIN,
    to: TaskState.ESCALATED,
    sideEffect: '向管理员对话线程升级提醒',
  },
  {
    from: TaskState.PUBLISHED,
    event: TaskEvent.PLATFORM_TAKEDOWN,
    to: TaskState.TAKEDOWN,
    sideEffect: '冻结该视频后续自动追加策略',
  },
  {
    from: TaskState.TAKEDOWN,
    event: TaskEvent.START_REFUND_REVIEW,
    to: TaskState.REFUND_REVIEW,
    sideEffect: '创建退款审核单并通知内部运营',
  },
  {
    from: TaskState.CREATED,
    event: TaskEvent.CANCEL,
    to: TaskState.CANCELLED,
    sideEffect: '取消任务且不扣费',
  },
  {
    from: TaskState.PRODUCING,
    event: TaskEvent.CANCEL,
    to: TaskState.CANCELLED,
    sideEffect: '停止在途任务并保留已耗成本记录',
  },
  {
    from: TaskState.QA_FAILED,
    event: TaskEvent.CANCEL,
    to: TaskState.CANCELLED,
    sideEffect: '取消失败任务且不扣费',
  },
  {
    from: TaskState.QA_PASSED,
    event: TaskEvent.CANCEL,
    to: TaskState.CANCELLED,
    sideEffect: '取消待分发任务且不扣费',
  },
  {
    from: TaskState.DISPATCHED,
    event: TaskEvent.CANCEL,
    to: TaskState.CANCELLED,
    sideEffect: '取消待发布任务且不扣费',
  },
  {
    from: TaskState.REJECTED,
    event: TaskEvent.CANCEL,
    to: TaskState.CANCELLED,
    sideEffect: '取消被拒任务且不扣费',
  },
  {
    from: TaskState.EDITING,
    event: TaskEvent.CANCEL,
    to: TaskState.CANCELLED,
    sideEffect: '取消修改任务且不扣费',
  },
  {
    from: TaskState.PUBLISHED,
    event: TaskEvent.CANCEL,
    to: TaskState.CANCELLED,
    sideEffect: '取消已发布但未入账任务且不扣费',
  },
]

/**
 * 终态集合
 */
export const TERMINAL_STATES: readonly TaskState[] = [
  TaskState.BILLABLE,
  TaskState.SUSPENDED,
  TaskState.REFUND_REVIEW,
  TaskState.CANCELLED,
]

/**
 * 合格成品规则常量
 */
export const QUALIFIED_ARTIFACT_RULE: QualifiedArtifactRule = {
  minQaScore: 70,
  dedupUniqueRequired: true,
  compliancePassedRequired: true,
}

/**
 * 根据状态和事件查表返回下一状态
 */
export function transition(state: TaskState, event: TaskEvent): TaskState {
  const next = TRANSITIONS.find(item => item.from === state && item.event === event)

  if (!next) {
    throw new Error(`Invalid transition: ${state} -> ${event}`)
  }

  return next.to
}
