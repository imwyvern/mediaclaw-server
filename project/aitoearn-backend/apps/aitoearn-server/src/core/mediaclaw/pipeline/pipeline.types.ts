export interface PipelineFrameArtifact {
  index: number
  label: string
  timestampSeconds: number
  sourcePath: string
  editedPath?: string
  styleRewritePlan?: PipelineStyleRewritePlan | null
}

export type PipelineStyleRewriteScope = 'shared' | 'per_scene'

export interface PipelineStyleRewriteConfig {
  enabled: boolean
  scope: PipelineStyleRewriteScope
  preserveComposition: boolean
  preserveProductPlacement: boolean
  mutationDomains: string[]
}

export interface PipelineStyleRewritePlan {
  enabled: boolean
  promptKey: string
  seed: number
  templateId: string
  scope: PipelineStyleRewriteScope
  preserveComposition: boolean
  preserveProductPlacement: boolean
  mutationDomains: string[]
  tableSurfaceMaterial: string
  tableware: string
  flowers: string
  ornaments: string
  lightingDirection: string
  colorTemperature: string
  backgroundElement: string
}

export interface PipelineSubtitleVariant {
  text: string
  startSeconds: number
  endSeconds: number
}

export interface PipelineDedupStrategy {
  cropScale: number
  cropXRatio: number
  cropYRatio: number
  hueShift: number
  saturation: number
  contrast: number
  brightness: number
  noise: number
  speedFactor: number
  metadataFingerprint: string
}

export interface PipelineBrandProfile {
  id: string | null
  name: string
  colors: string[]
  fonts: string[]
  slogans: string[]
  keywords: string[]
  prohibitedWords: string[]
  preferredDuration: number
  aspectRatio: string
  subtitleStyle: Record<string, unknown>
  referenceVideoUrl: string
}

export interface PipelineVideoMetadata {
  durationSeconds: number
  width: number
  height: number
  frameRate: number
  hasAudio: boolean
}

export interface PipelineQualityMetrics {
  width: number
  height: number
  duration: number
  fileSize: number
  hasSubtitles: boolean
  shortEdge: number
  aspectRatio: string
}

export interface PipelineQualityDimensionScores {
  resolution: number
  fileSize: number
  subtitles: number
  duration: number
  clarity: number
  composition: number
  viralityHook: number
}

export interface PipelineQualityDimensionThresholds {
  resolution: number
  fileSize: number
  subtitles: number
  duration: number
  clarity: number
  composition: number
  viralityHook: number
}

export interface PipelineQualityScore {
  total: number
  production: number
  virality: number
  dimensions: PipelineQualityDimensionScores
  thresholds: PipelineQualityDimensionThresholds
}

export type PipelineQualityCheckKey
  = | 'resolution'
    | 'fileSize'
    | 'subtitles'
    | 'duration'
    | 'clarity'
    | 'composition'
    | 'viralityHook'

export type PipelineQualityCheckSeverity = 'pass' | 'warning' | 'veto'
export type PipelineQualityDimensionLevel = 'L1' | 'L2' | 'L3'

export interface PipelineQualityCheck {
  key: PipelineQualityCheckKey
  label: string
  level: PipelineQualityDimensionLevel
  score: number
  threshold: number
  warningThreshold: number
  passed: boolean
  severity: PipelineQualityCheckSeverity
  message: string
}

export interface PipelineQualityReport {
  passed: boolean
  metrics: PipelineQualityMetrics
  score: PipelineQualityScore
  checks: PipelineQualityCheck[]
  vetoKeys: PipelineQualityCheckKey[]
  errors: string[]
  warnings: string[]
}

export interface PipelineDeepSynthesisManifest {
  standard: string
  label: string
  watermarkText: string
  brandName: string
  taskId: string
  appliedAt: string
  metadata: Record<string, string>
}

export interface PipelineDeepSynthesisMarker {
  visibleLabel: string
  watermarkText: string
  metadata: Record<string, string>
  manifest: PipelineDeepSynthesisManifest
}

export interface PipelineSubtitleRenderResult {
  outputPath: string
  deepSynthesisMarker: PipelineDeepSynthesisMarker
}

export interface PipelineStepExecutionResult {
  provider: string
  status: 'completed' | 'skipped'
  reason?: string
}

export interface PipelineResolvedModel {
  capability: 'copy' | 'frameEdit' | 'videoGen'
  id: string
  label: string
  provider: string
  runtimeModel: string
  source: 'default' | 'organization' | 'pipeline'
}

export interface PipelineResolvedModels {
  copy: PipelineResolvedModel
  frameEdit: PipelineResolvedModel
  videoGen: PipelineResolvedModel
}

export interface PipelineTemplatePayload {
  topic?: string
  script?: string
  bulletPoints: string[]
}

export interface PipelineJobContext {
  taskId: string
  orgId?: string | null
  workspaceDir: string
  templateId: string
  sourceVideoPath: string
  sourceMetadata: PipelineVideoMetadata
  targetDurationSeconds: number
  renderWidth: number
  renderHeight: number
  brand: PipelineBrandProfile
  styleRewrite: PipelineStyleRewriteConfig
  frameArtifacts: PipelineFrameArtifact[]
  segmentVideoPaths: string[]
  subtitles: PipelineSubtitleVariant[]
  dedupStrategy: PipelineDedupStrategy
  preserveSourceAudio: boolean
  prompts: Record<string, string>
  models: PipelineResolvedModels
  templatePayload?: PipelineTemplatePayload
  composedVideoPath?: string
  subtitledVideoPath?: string
  finalVideoPath?: string
  outputVideoUrl?: string
  voiceoverPath?: string
  voiceoverUrl?: string
  voiceoverMeta?: {
    provider: string
    voiceId: string
    format: string
    sampleRate: number
    durationMs: number | null
    text: string
  }
  deepSynthesisMarker?: PipelineDeepSynthesisMarker
  brandEditResult?: PipelineStepExecutionResult
  videoGenResult?: PipelineStepExecutionResult
  qualityReport?: PipelineQualityReport
}
