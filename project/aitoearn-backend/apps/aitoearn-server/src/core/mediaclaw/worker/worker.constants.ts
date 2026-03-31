import type { PipelineJobContext } from '../pipeline/pipeline.types'

export const MEDIACLAW_PIPELINE_QUEUE = 'mediaclaw_pipeline'
export const VIDEO_WORKER_QUEUE = MEDIACLAW_PIPELINE_QUEUE

export const VIDEO_WORKER_STEPS = [
  'analyze-source',
  'edit-frames',
  'render-video',
  'quality-check',
  'generate-copy',
] as const

export type VideoWorkerStep = typeof VIDEO_WORKER_STEPS[number]

export interface VideoWorkerJobData {
  taskId: string
  context?: PipelineJobContext
}
