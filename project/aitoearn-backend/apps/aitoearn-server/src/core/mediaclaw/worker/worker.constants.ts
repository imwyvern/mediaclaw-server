export const VIDEO_WORKER_QUEUE = 'mediaclaw_video_worker'

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
}
