export interface PipelineFrameArtifact {
  index: number
  label: string
  timestampSeconds: number
  sourcePath: string
  editedPath?: string
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
}

export interface PipelineQualityReport {
  passed: boolean
  metrics: PipelineQualityMetrics
  errors: string[]
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

export interface PipelineJobContext {
  taskId: string
  orgId?: string | null
  workspaceDir: string
  sourceVideoPath: string
  sourceMetadata: PipelineVideoMetadata
  targetDurationSeconds: number
  renderWidth: number
  renderHeight: number
  brand: PipelineBrandProfile
  frameArtifacts: PipelineFrameArtifact[]
  segmentVideoPaths: string[]
  subtitles: PipelineSubtitleVariant[]
  dedupStrategy: PipelineDedupStrategy
  preserveSourceAudio: boolean
  prompts: Record<string, string>
  composedVideoPath?: string
  subtitledVideoPath?: string
  finalVideoPath?: string
  outputVideoUrl?: string
  deepSynthesisMarker?: PipelineDeepSynthesisMarker
}
