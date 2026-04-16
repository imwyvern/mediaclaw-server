import type {
  EditType,
  HeroSkillId,
  InsightMode,
  Platform,
  RouteProvider,
  ToolErrorCode,
  ToolId,
  TransitionType,
  TrendMode,
  VideoModel,
} from './enums'
import { TaskState } from './enums'

/**
 * Tool 调用契约
 */
export interface ToolContract {
  /**
   * Tool 唯一标识
   */
  toolId: ToolId
  /**
   * 默认超时毫秒数
   */
  timeoutMs: number
  /**
   * 是否允许 Agent 自动重试
   */
  retryable: boolean
  /**
   * Agent 可自动重试的最大次数
   */
  maxRetries: number
}

/**
 * Hero Skill 契约
 */
export interface HeroSkillContract {
  /**
   * Skill 唯一标识
   */
  skillId: HeroSkillId
  /**
   * 默认超时毫秒数
   */
  timeoutMs: number
  /**
   * 是否允许 Agent 自动重试
   */
  retryable: boolean
  /**
   * Agent 可自动重试的最大次数
   */
  maxRetries: number
  /**
   * 固定为 true，明确只能由 Agent 调用
   */
  agentOnly: true
}

/**
 * 资产引用
 */
export interface AssetRef {
  /**
   * 资产 ID，必填
   */
  assetId: string
  /**
   * 对象存储路径，必填
   */
  storageKey: string
  /**
   * 可访问 URL，可选
   */
  url?: string
  /**
   * 素材 SHA256，必填
   */
  sha256: string
  /**
   * MIME 类型，必填
   */
  mimeType: string
}

/**
 * 图片资产引用
 */
export interface ImageAssetRef extends AssetRef {
  /**
   * 宽度像素，必填
   */
  width: number
  /**
   * 高度像素，必填
   */
  height: number
}

/**
 * 视频资产引用
 */
export interface VideoAssetRef extends AssetRef {
  /**
   * 时长秒，必填
   */
  durationSec: number
  /**
   * 宽度像素，必填
   */
  width: number
  /**
   * 高度像素，必填
   */
  height: number
  /**
   * 帧率，必填
   */
  fps: number
  /**
   * 是否包含音频，必填
   */
  hasAudio: boolean
}

/**
 * 品牌信息
 */
export interface BrandProfile {
  /**
   * 品牌 ID，必填
   */
  brandId: string
  /**
   * 品牌名称，必填
   */
  brandName: string
  /**
   * 行业名称，必填
   */
  industry: string
  /**
   * 品牌 slogan，可选
   */
  slogan?: string
  /**
   * 品牌语气标签，可选
   */
  toneTags?: string[]
}

/**
 * 产品信息
 */
export interface ProductProfile {
  /**
   * 产品 ID，必填
   */
  productId: string
  /**
   * 产品名称，必填
   */
  name: string
  /**
   * 产品卖点列表，必填且至少 1 项
   */
  features: string[]
  /**
   * 产品图列表，必填且至少 1 张
   */
  images: ImageAssetRef[]
}

/**
 * 场景切片
 */
export interface SceneCut {
  /**
   * 镜头 ID，必填
   */
  cutId: string
  /**
   * 起始秒，必填
   */
  startSec: number
  /**
   * 结束秒，必填
   */
  endSec: number
  /**
   * 首帧图片，必填
   */
  firstFrame: ImageAssetRef
  /**
   * 镜头描述，可选
   */
  sceneDescription?: string
}

/**
 * 运镜分析结果
 */
export interface MotionAnalysis {
  /**
   * 镜头 ID，必填
   */
  cutId: string
  /**
   * 运镜类型，必填
   */
  motionType: string
  /**
   * 生成模型可直接消费的 motion prompt，必填
   */
  motionPrompt: string
  /**
   * 置信度，0-1，必填
   */
  confidence: number
}

/**
 * 文案句子
 */
export interface ScriptLine {
  /**
   * 句子 ID，必填
   */
  lineId: string
  /**
   * 文案文本，必填
   */
  text: string
  /**
   * 目标镜头 ID，可选
   */
  targetCutId?: string
  /**
   * 建议时长秒，必填
   */
  durationSec: number
}

/**
 * 成本拆分
 */
export interface CostBreakdown {
  /**
   * 替换成本，可选
   */
  replacement?: number
  /**
   * 生成成本，可选
   */
  generation?: number
  /**
   * 配音成本，可选
   */
  tts?: number
  /**
   * 合成成本，可选
   */
  compose?: number
  /**
   * 总成本，必填
   */
  total: number
}

/**
 * QA 问题项
 */
export interface QaIssue {
  /**
   * 问题分类，必填
   */
  type: string
  /**
   * 问题说明，必填
   */
  message: string
  /**
   * 严重等级，必填
   */
  severity: 'low' | 'medium' | 'high'
}

/**
 * 质量报告
 */
export interface QualityReport {
  /**
   * QA 分数，0-100，必填
   */
  qaScore: number
  /**
   * 是否通过，必填
   */
  passed: boolean
  /**
   * 问题列表，必填
   */
  issues: QaIssue[]
}

/**
 * 合规结果
 */
export interface ComplianceCheck {
  /**
   * 是否通过，必填
   */
  passed: boolean
  /**
   * 告警列表，必填
   */
  warnings: string[]
  /**
   * 违规列表，必填
   */
  violations: string[]
}

/**
 * 统一 Tool 响应元信息
 */
export interface ToolResponseMeta {
  /**
   * 响应状态，必填
   */
  status: 'success' | 'failed' | 'partial'
  /**
   * 错误码，必填
   */
  errorCode: ToolErrorCode
  /**
   * 是否可重试，必填
   */
  retryable: boolean
  /**
   * 结果置信度，0-1，必填
   */
  confidence: number
  /**
   * 本次调用成本（人民币元），必填
   */
  costYuan: number
  /**
   * 是否要求人工复核，必填
   */
  humanReviewRequired: boolean
  /**
   * 副作用列表，必填
   */
  sideEffects: string[]
}

/**
 * 竞品报告
 */
export interface CompetitorReport {
  /**
   * 新发视频列表，必填
   */
  newVideos: Array<{
    url: string
    postedAt: string
    performance: { views?: number, likes?: number, comments?: number }
  }>
  /**
   * 风格趋势，必填
   */
  styleTrends: string[]
  /**
   * 机会建议，必填
   */
  opportunity: string
}

/**
 * 周计划项
 */
export interface WeeklyPlanItem {
  /**
   * 星期，必填
   */
  day: string
  /**
   * 内容类型，必填
   */
  contentType: string
  /**
   * 参考链接，可选
   */
  referenceUrl?: string
  /**
   * 目标平台，必填
   */
  platform: Platform
  /**
   * 选择原因，必填
   */
  reason: string
  /**
   * 预计使用的管线，必填
   */
  pipeline: HeroSkillId
}

/**
 * remix-brief 结构
 */
export interface RemixBrief {
  /**
   * 总时长秒，必填
   */
  totalDurationSec: number
  /**
   * 镜头切片，必填
   */
  cuts: Array<SceneCut & { motionType?: string, motionPrompt?: string }>
  /**
   * 建议文案，必填
   */
  script: ScriptLine[]
  /**
   * 模型分配，必填
   */
  modelAllocation: Array<{ cutId: string, model: VideoModel, reason: string }>
  /**
   * 预估成本，必填
   */
  estimatedCostYuan: number
  /**
   * 预估时长分钟，必填
   */
  estimatedTimeMin: number
}

/**
 * 实时效果指标
 */
export interface RealtimeInsight {
  /**
   * 视频 ID，必填
   */
  videoId: string
  /**
   * 平台，必填
   */
  platform: Platform
  /**
   * 指标，必填
   */
  metrics: {
    views: number
    likes: number
    comments: number
    shares: number
    saves?: number
  }
  /**
   * 行业基准说明，必填
   */
  benchmark: string
  /**
   * 诊断结论，必填
   */
  diagnosis: string
  /**
   * 动作建议，必填
   */
  actionSuggestion: string
}

/**
 * 月报输出
 */
export interface MonthlyInsightReport {
  /**
   * 周期，必填
   */
  period: string
  /**
   * 概要，必填
   */
  summary: string
  /**
   * 成本节省说明，必填
   */
  savings: string
  /**
   * 最佳内容类型，必填
   */
  bestType: string
  /**
   * 下月建议，必填
   */
  recommendation: string
}

/**
 * 视频下载输入
 */
export interface VideoDownloadInput {
  /**
   * 源视频链接，必填
   */
  sourceUrl: string
  /**
   * 预期平台，可选
   */
  expectedPlatform?: Platform
  /**
   * 优先下载源，可选
   */
  preferredSources?: RouteProvider[]
  /**
   * 最大可接受时长秒，可选，默认 600
   */
  maxDurationSec?: number
}

/**
 * 视频下载输出
 */
export interface VideoDownloadOutput {
  /**
   * 下载后的本地/对象存储视频，必填
   */
  video: VideoAssetRef
  /**
   * 实际使用的数据源，必填
   */
  sourceUsed: RouteProvider
  /**
   * 回退尝试次数，必填
   */
  fallbackAttempts: number
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 场景切割输入
 */
export interface SceneCutterInput {
  /**
   * 输入视频，必填
   */
  video: VideoAssetRef
  /**
   * 场景切割阈值，可选，0-1，默认 0.35
   */
  threshold?: number
  /**
   * 是否抽取首帧，必填
   */
  extractFirstFrame: boolean
  /**
   * 最大镜头数，可选
   */
  maxCuts?: number
}

/**
 * 场景切割输出
 */
export interface SceneCutterOutput {
  /**
   * 镜头切片列表，必填
   */
  cuts: SceneCut[]
  /**
   * 实际阈值，必填
   */
  thresholdUsed: number
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 运镜分析输入
 */
export interface MotionAnalyzerInput {
  /**
   * 镜头切片列表，必填
   */
  cuts: SceneCut[]
  /**
   * 风格提示，可选
   */
  styleHint?: string
}

/**
 * 运镜分析输出
 */
export interface MotionAnalyzerOutput {
  /**
   * 运镜结果列表，必填
   */
  motions: MotionAnalysis[]
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 品牌替换输入
 */
export interface BrandReplacerInput {
  /**
   * 原始首帧图片，必填
   */
  sourceFrame: ImageAssetRef
  /**
   * 目标品牌，必填
   */
  targetBrand: BrandProfile
  /**
   * 目标产品，必填
   */
  targetProduct: ProductProfile
  /**
   * 品牌区域提示，可选
   */
  brandRegionHint?: { x: number, y: number, width: number, height: number }
  /**
   * 保护规则，可选
   */
  preserveRules?: string[]
  /**
   * 路由策略，可选
   */
  routePolicy?: RouteProvider[]
}

/**
 * 品牌替换输出
 */
export interface BrandReplacerOutput {
  /**
   * 替换后的首帧图片，必填
   */
  replacedFrame: ImageAssetRef
  /**
   * 实际使用路由，必填
   */
  routeUsed: RouteProvider
  /**
   * 视觉问题提示，必填
   */
  artifactHints: string[]
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 替换校验输入
 */
export interface ReplacementValidatorInput {
  /**
   * 原始帧，必填
   */
  originalFrame: ImageAssetRef
  /**
   * 替换后帧，必填
   */
  replacedFrame: ImageAssetRef
  /**
   * 最小 SSIM，可选，默认 0.5
   */
  minSsim?: number
  /**
   * 最大 SSIM，可选，默认 0.95
   */
  maxSsim?: number
  /**
   * 品牌区域提示，可选
   */
  brandRegionHint?: { x: number, y: number, width: number, height: number }
}

/**
 * 替换校验输出
 */
export interface ReplacementValidatorOutput {
  /**
   * 是否通过，必填
   */
  passed: boolean
  /**
   * SSIM 分数，必填
   */
  ssim: number
  /**
   * 品牌区域是否发生变化，必填
   */
  brandChanged: boolean
  /**
   * 是否检测到瑕疵，必填
   */
  artifactDetected: boolean
  /**
   * 原因列表，必填
   */
  reasons: string[]
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 视频生成输入
 */
export interface VideoGeneratorInput {
  /**
   * 首帧图片，必填
   */
  firstFrame: ImageAssetRef
  /**
   * 运镜 prompt，必填
   */
  motionPrompt: string
  /**
   * 目标模型，必填
   */
  model: VideoModel
  /**
   * 目标时长秒，必填
   */
  durationSec: number
  /**
   * 随机种子，可选
   */
  seed?: number
}

/**
 * 视频生成输出
 */
export interface VideoGeneratorOutput {
  /**
   * 生成视频，必填
   */
  video: VideoAssetRef
  /**
   * 实际模型，必填
   */
  modelUsed: VideoModel
  /**
   * 生成成本，必填
   */
  estimatedCostYuan: number
  /**
   * 质量提示，必填
   */
  qualityHints: string[]
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 镜头升级输入
 */
export interface ShotUpgraderInput {
  /**
   * 原始镜头视频，必填
   */
  originalShot: VideoAssetRef
  /**
   * 升级模型，必填
   */
  upgradeModel: VideoModel
  /**
   * 升级原因，必填
   */
  reason: string
}

/**
 * 镜头升级输出
 */
export interface ShotUpgraderOutput {
  /**
   * 升级后镜头，必填
   */
  upgradedShot: VideoAssetRef
  /**
   * 提升摘要，必填
   */
  improvementSummary: string
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 文案生成输入
 */
export interface ScriptWriterInput {
  /**
   * 复刻 brief，可选
   */
  brief?: RemixBrief
  /**
   * 文案风格，必填
   */
  style: 'seed' | 'review' | 'story'
  /**
   * 语言，必填
   */
  language: 'zh-CN'
  /**
   * 单句最大字数，可选，默认 15
   */
  maxCharsPerLine?: number
  /**
   * 品牌信息，可选
   */
  brand?: BrandProfile
  /**
   * 产品信息，可选
   */
  product?: ProductProfile
}

/**
 * 文案生成输出
 */
export interface ScriptWriterOutput {
  /**
   * 文案句子列表，必填
   */
  lines: ScriptLine[]
  /**
   * 全量文案，必填
   */
  fullScript: string
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * TTS 输入
 */
export interface TTSEngineInput {
  /**
   * 文案句子列表，必填
   */
  lines: ScriptLine[]
  /**
   * 音色 ID，必填
   */
  voiceId: string
  /**
   * 语速，可选，默认 1.0
   */
  speed?: number
  /**
   * Payload 格式，必填
   */
  payloadFormat: 'req_params'
}

/**
 * TTS 输出
 */
export interface TTSEngineOutput {
  /**
   * 分段音频列表，必填
   */
  audioSegments: AssetRef[]
  /**
   * 合并音频，必填
   */
  mergedAudio: AssetRef
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 拼接输入
 */
export interface VideoAssemblerInput {
  /**
   * 输入镜头列表，必填
   */
  shots: VideoAssetRef[]
  /**
   * 转场类型，可选，默认 cut
   */
  transitionType?: TransitionType
  /**
   * 转场时长秒，可选
   */
  transitionDurationSec?: number
  /**
   * 输出宽高比，可选
   */
  targetAspectRatio?: '9:16' | '16:9' | '1:1'
}

/**
 * 拼接输出
 */
export interface VideoAssemblerOutput {
  /**
   * 拼接后视频，必填
   */
  video: VideoAssetRef
  /**
   * 实际转场类型，必填
   */
  transitionUsed: TransitionType
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 最终合成输入
 */
export interface FinalComposerInput {
  /**
   * 主视频，必填
   */
  video: VideoAssetRef
  /**
   * TTS 音频，可选
   */
  ttsAudio?: AssetRef
  /**
   * BGM 风格，可选
   */
  bgmStyle?: string
  /**
   * 字幕模式，可选
   */
  subtitleMode?: 'burn' | 'srt' | 'none'
  /**
   * 封面帧，可选
   */
  coverFrame?: ImageAssetRef
}

/**
 * 最终合成输出
 */
export interface FinalComposerOutput {
  /**
   * 合成后视频，必填
   */
  video: VideoAssetRef
  /**
   * 字幕文件，可选
   */
  subtitleFile?: AssetRef
  /**
   * BGM 资源，可选
   */
  bgmTrack?: AssetRef
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * Remotion 渲染输入
 */
export interface RemotionRenderInput {
  /**
   * 产品信息，必填
   */
  product: ProductProfile
  /**
   * 模板 ID，必填
   */
  templateId: string
  /**
   * 输出时长秒，必填
   */
  durationSec: number
  /**
   * 品牌主题，可选
   */
  brandTheme?: {
    primaryColor?: string
    secondaryColor?: string
    fontFamily?: string
  }
}

/**
 * Remotion 渲染输出
 */
export interface RemotionRenderOutput {
  /**
   * 渲染视频，必填
   */
  video: VideoAssetRef
  /**
   * 渲染任务 ID，必填
   */
  renderJobId: string
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * QA 输入
 */
export interface QAOptimizerInput {
  /**
   * 待质检视频，必填
   */
  video: VideoAssetRef
  /**
   * 平台上下文，可选
   */
  platform?: Platform
  /**
   * 质检轮次，必填
   */
  attempt: number
  /**
   * 目标风格，可选
   */
  expectedStyle?: string
}

/**
 * QA 输出
 */
export interface QAOptimizerOutput {
  /**
   * 是否通过，必填
   */
  passed: boolean
  /**
   * QA 分数，必填
   */
  qaScore: number
  /**
   * 分维度分数，必填
   */
  dimensions: {
    visual: number
    branding: number
    audio: number
    compliance: number
    platformFit: number
    dedupRisk: number
    engagement: number
  }
  /**
   * 问题列表，必填
   */
  issues: QaIssue[]
  /**
   * 重试建议，必填
   */
  retryRecommendation: 'retry' | 'reroute' | 'suspend'
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 查重输入
 */
export interface DedupGatekeeperInput {
  /**
   * 待查重视频，必填
   */
  video: VideoAssetRef
  /**
   * 回看窗口天数，可选，默认 30
   */
  historyWindowDays?: number
  /**
   * 语义库 ID 列表，可选
   */
  semanticCorpusIds?: string[]
}

/**
 * 查重输出
 */
export interface DedupGatekeeperOutput {
  /**
   * 是否唯一，必填
   */
  unique: boolean
  /**
   * 视觉距离，0-1，必填
   */
  visualDistance: number
  /**
   * 音频距离，0-1，必填
   */
  audioDistance: number
  /**
   * 语义距离，0-1，必填
   */
  semanticDistance: number
  /**
   * 是否需要重写风格，必填
   */
  rewriteRequired: boolean
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 风格变异输入
 */
export interface StyleRewriterInput {
  /**
   * 输入视频，必填
   */
  video: VideoAssetRef
  /**
   * 变异维度，必填
   */
  rewriteAxes: Array<'color' | 'speed' | 'crop' | 'subtitle' | 'bgm'>
  /**
   * 变异强度，0-1，必填
   */
  intensity: number
}

/**
 * 风格变异输出
 */
export interface StyleRewriterOutput {
  /**
   * 变异后视频，必填
   */
  video: VideoAssetRef
  /**
   * 实际变更项，必填
   */
  appliedChanges: string[]
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 合规审核输入
 */
export interface ContentReviewerInput {
  /**
   * 平台，必填
   */
  platform: Platform
  /**
   * 标题，可选
   */
  title?: string
  /**
   * 正文，可选
   */
  description?: string
  /**
   * 话题列表，可选
   */
  hashtags?: string[]
  /**
   * 视频，可选
   */
  video?: VideoAssetRef
}

/**
 * 合规审核输出
 */
export interface ContentReviewerOutput {
  /**
   * 合规检查结果，必填
   */
  compliance: ComplianceCheck
  /**
   * 清洗后的 copy，可选
   */
  sanitizedCopy?: {
    title?: string
    description?: string
    hashtags?: string[]
  }
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 封面设计输入
 */
export interface CoverDesignerInput {
  /**
   * 平台，必填
   */
  platform: Platform
  /**
   * 输入帧，可选
   */
  sourceFrame?: ImageAssetRef
  /**
   * 产品信息，必填
   */
  product: ProductProfile
  /**
   * 标题文案，可选
   */
  headline?: string
  /**
   * 风格提示，可选
   */
  styleHint?: string
}

/**
 * 封面设计输出
 */
export interface CoverDesignerOutput {
  /**
   * 封面图，必填
   */
  coverImage: ImageAssetRef
  /**
   * 标题建议，必填
   */
  headlineSuggestion: string
  /**
   * 安全区定义，必填
   */
  safeArea: { top: number, right: number, bottom: number, left: number }
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 局部编辑输入
 */
export interface VideoEditorInput {
  /**
   * 原始成品视频，必填
   */
  originalVideo: VideoAssetRef
  /**
   * 编辑类型，必填
   */
  editType: EditType
  /**
   * 编辑请求，必填
   */
  editRequest:
    | { type: 'script', lineId: string, newText: string }
    | { type: 'subtitle', corrections: Array<{ timeSec: number, oldText: string, newText: string }> }
    | { type: 'cover', newCoverPrompt: string }
    | { type: 'shot', shotId: string, newMotionPrompt?: string, newModel?: VideoModel }
    | { type: 'bgm', newBgmStyle: string }
  /**
   * 是否复用中间产物，必填
   */
  reuseArtifacts: boolean
}

/**
 * 局部编辑输出
 */
export interface VideoEditorOutput {
  /**
   * 修改后视频，必填
   */
  editedVideo: VideoAssetRef
  /**
   * 最小重跑计划，必填
   */
  rerunPlan: string[]
  /**
   * 增量成本（元），必填
   */
  incrementalCostYuan: number
  /**
   * 更新后的中间产物列表，必填
   */
  updatedArtifacts: AssetRef[]
  /**
   * 元信息，必填
   */
  meta: ToolResponseMeta
}

/**
 * 趋势发现输入
 */
export interface TrendingScoutInput {
  /**
   * 模式，必填
   */
  mode: TrendMode
  /**
   * 类目，discover 模式必填
   */
  category?: string
  /**
   * 平台，discover 模式必填
   */
  platform?: Platform
  /**
   * 回看天数，discover/competitor 通用，可选
   */
  days?: number
  /**
   * 返回条数，可选
   */
  limit?: number
  /**
   * 竞品账号，competitor 模式必填
   */
  competitorAccounts?: string[]
}

/**
 * 趋势发现输出
 */
export interface TrendingScoutOutput {
  /**
   * discover 模式返回视频列表
   */
  videos?: Array<{
    url: string
    title: string
    likes?: number
    shares?: number
    styleTags?: string[]
  }>
  /**
   * competitor 模式返回竞品报告
   */
  competitorReport?: CompetitorReport
}

/**
 * 内容策划输入
 */
export interface ContentPlannerInput {
  /**
   * 品牌信息，必填
   */
  brand: BrandProfile
  /**
   * 产品信息列表，必填
   */
  products: ProductProfile[]
  /**
   * 最近 30 天效果快照，必填
   */
  recentPerformance: Array<{
    contentType: string
    avgViews: number
    avgEngagementRate: number
  }>
  /**
   * 竞品报告，可选
   */
  competitorReport?: CompetitorReport
  /**
   * 剩余额度条数，必填
   */
  budgetRemaining: number
  /**
   * 每周计划条数，可选
   */
  postsPerWeek?: number
}

/**
 * 内容策划输出
 */
export interface ContentPlannerOutput {
  /**
   * 周计划列表，必填
   */
  weeklyPlan: WeeklyPlanItem[]
  /**
   * 月计划摘要，可选
   */
  monthlyCalendarSummary?: string
}

/**
 * 复刻拆解输入
 */
export interface RemixBriefInput {
  /**
   * 参考视频链接，必填
   */
  referenceUrl: string
  /**
   * 目标品牌，必填
   */
  targetBrand: BrandProfile
  /**
   * 目标产品，必填
   */
  targetProduct: ProductProfile
}

/**
 * 复刻拆解输出
 */
export interface RemixBriefOutput {
  /**
   * 复刻 brief，必填
   */
  brief: RemixBrief
}

/**
 * 种草管线输入
 */
export interface ProductShowcasePipelineInput {
  /**
   * 复刻 brief，必填
   */
  brief: RemixBrief
  /**
   * 目标品牌，必填
   */
  targetBrand: BrandProfile
  /**
   * 目标产品，必填
   */
  targetProduct: ProductProfile
  /**
   * 质量等级，必填
   */
  qualityLevel: 'standard' | 'premium'
}

/**
 * 种草管线输出
 */
export interface ProductShowcasePipelineOutput {
  /**
   * 最终视频，必填
   */
  finalVideo: VideoAssetRef
  /**
   * 成本拆分，必填
   */
  costBreakdown: CostBreakdown
  /**
   * 质量报告，必填
   */
  qualityReport: QualityReport
  /**
   * 当前状态，必填
   */
  state: TaskState.QA_PASSED | TaskState.PRODUCING | TaskState.SUSPENDED
}

/**
 * AI 微动输入
 */
export interface AiLivePipelineInput {
  /**
   * 产品图列表，必填
   */
  productImages: ImageAssetRef[]
  /**
   * 风格提示，必填
   */
  style: string
  /**
   * 目标时长秒，必填
   */
  durationSec: number
}

/**
 * AI 微动输出
 */
export interface AiLivePipelineOutput {
  /**
   * 最终视频，必填
   */
  finalVideo: VideoAssetRef
  /**
   * 成本拆分，必填
   */
  costBreakdown: CostBreakdown
  /**
   * 质量报告，必填
   */
  qualityReport: QualityReport
}

/**
 * 讲解视频输入
 */
export interface ExplainerPipelineInput {
  /**
   * 产品信息，必填
   */
  product: ProductProfile
  /**
   * 模板 ID，必填
   */
  templateId: string
  /**
   * 目标时长秒，必填
   */
  durationSec: number
}

/**
 * 讲解视频输出
 */
export interface ExplainerPipelineOutput {
  /**
   * 最终视频，必填
   */
  finalVideo: VideoAssetRef
  /**
   * 成本拆分，必填
   */
  costBreakdown: CostBreakdown
  /**
   * 质量报告，必填
   */
  qualityReport: QualityReport
}

/**
 * 平台包装输入
 */
export interface PlatformPackagerInput {
  /**
   * 成品视频，必填
   */
  video: VideoAssetRef
  /**
   * 目标平台，必填
   */
  platform: Platform
  /**
   * 品牌信息，必填
   */
  brand: BrandProfile
  /**
   * 产品信息，必填
   */
  product: ProductProfile
}

/**
 * 平台包装输出
 */
export interface PlatformPackagerOutput {
  /**
   * 平台标题，必填
   */
  title: string
  /**
   * 封面图，必填
   */
  coverImage: ImageAssetRef
  /**
   * 话题列表，必填
   */
  hashtags: string[]
  /**
   * 正文，必填
   */
  description: string
  /**
   * 合规检查，必填
   */
  complianceCheck: ComplianceCheck
}

/**
 * 效果洞察输入
 */
export interface PerformanceInsightInput {
  /**
   * 模式，必填
   */
  mode: InsightMode
  /**
   * realtime 模式视频 ID，可选
   */
  videoId?: string
  /**
   * 平台，可选
   */
  platform?: Platform
  /**
   * 发布时间，可选
   */
  publishTime?: string
  /**
   * monthly 模式周期，可选
   */
  period?: string
  /**
   * 组织 ID，monthly 模式必填
   */
  orgId?: string
}

/**
 * 效果洞察输出
 */
export interface PerformanceInsightOutput {
  /**
   * 实时结果，可选
   */
  realtime?: RealtimeInsight
  /**
   * 月报结果，可选
   */
  monthly?: MonthlyInsightReport
}
