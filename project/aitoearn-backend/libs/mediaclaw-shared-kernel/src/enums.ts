/**
 * 任务状态枚举
 */
export enum TaskState {
  CREATED = 'CREATED',
  PRODUCING = 'PRODUCING',
  QA_PASSED = 'QA_PASSED',
  QA_FAILED = 'QA_FAILED',
  SUSPENDED = 'SUSPENDED',
  DISPATCHED = 'DISPATCHED',
  REJECTED = 'REJECTED',
  EDITING = 'EDITING',
  PUBLISHED = 'PUBLISHED',
  BILLABLE = 'BILLABLE',
  DISPATCH_TIMEOUT = 'DISPATCH_TIMEOUT',
  ESCALATED = 'ESCALATED',
  TAKEDOWN = 'TAKEDOWN',
  REFUND_REVIEW = 'REFUND_REVIEW',
  CANCELLED = 'CANCELLED',
}

/**
 * 状态事件枚举
 */
export enum TaskEvent {
  START_PRODUCING = 'START_PRODUCING',
  QA_PASS = 'QA_PASS',
  QA_FAIL = 'QA_FAIL',
  RETRY_AFTER_QA_FAIL = 'RETRY_AFTER_QA_FAIL',
  EXHAUST_RETRIES = 'EXHAUST_RETRIES',
  DISPATCH = 'DISPATCH',
  CUSTOMER_REJECT = 'CUSTOMER_REJECT',
  START_EDIT = 'START_EDIT',
  EDIT_COMPLETE = 'EDIT_COMPLETE',
  PUBLISH_CONFIRMED = 'PUBLISH_CONFIRMED',
  CAPTURE_BILLING = 'CAPTURE_BILLING',
  DISPATCH_TIMEOUT = 'DISPATCH_TIMEOUT',
  ESCALATE_TO_ADMIN = 'ESCALATE_TO_ADMIN',
  PLATFORM_TAKEDOWN = 'PLATFORM_TAKEDOWN',
  START_REFUND_REVIEW = 'START_REFUND_REVIEW',
  CANCEL = 'CANCEL',
}

/**
 * 可用平台
 */
export type Platform = 'douyin' | 'xhs' | 'kuaishou' | 'bilibili'

/**
 * 采集模式
 */
export type TrendMode = 'discover' | 'competitor'

/**
 * 效果洞察模式
 */
export type InsightMode = 'realtime' | 'monthly'

/**
 * 视频生成模型
 */
export type VideoModel = 'seedance-2.0' | 'seedance-1.5' | 'kling' | 'remotion'

/**
 * Provider 路由
 */
export type RouteProvider
  = | 'tikhub'
    | 'yt-dlp'
    | 'direct'
    | 'vce'
    | 'apikeyclaw'
    | 'gemini-cli'
    | 'seedance-2.0'
    | 'seedance-1.5'
    | 'remotion'

/**
 * 转场类型
 */
export type TransitionType = 'cut' | 'crossfade' | 'fade' | 'slide'

/**
 * 编辑类型
 */
export type EditType = 'script' | 'subtitle' | 'cover' | 'shot' | 'bgm'

/**
 * Tool 标识
 */
export type ToolId
  = | 'video-download'
    | 'scene-cutter'
    | 'motion-analyzer'
    | 'brand-replacer'
    | 'replacement-validator'
    | 'video-generator'
    | 'shot-upgrader'
    | 'script-writer'
    | 'tts-engine'
    | 'video-assembler'
    | 'final-composer'
    | 'remotion-render'
    | 'qa-optimizer'
    | 'dedup-gatekeeper'
    | 'style-rewriter'
    | 'content-reviewer'
    | 'cover-designer'
    | 'video-editor'

/**
 * Tool 错误码
 */
export type ToolErrorCode
  = | 'NONE'
    | 'TIMEOUT'
    | 'API_DOWN'
    | 'QA_FAIL'
    | 'RATE_LIMIT'
    | 'CONTENT_VIOLATION'
    | 'INPUT_MISSING'
    | 'VALIDATION_FAILED'
    | 'DEDUP_FAIL'
    | 'LOW_CONFIDENCE'
    | 'BUDGET_EXCEEDED'
    | 'DISPATCH_TIMEOUT'
    | 'TAKEDOWN_REPORTED'
    | 'UNKNOWN'

/**
 * Hero Skill 标识
 */
export type HeroSkillId
  = | 'trending-scout'
    | 'content-planner'
    | 'remix-brief'
    | 'product-showcase-pipeline'
    | 'ai-live-pipeline'
    | 'explainer-pipeline'
    | 'platform-packager'
    | 'performance-insight'
