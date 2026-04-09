export enum PipelineFeedbackSourceType {
  BOSS = 'boss',
  OPERATOR = 'operator',
  PERFORMANCE = 'performance',
  REJECTION = 'rejection',
}

export const PIPELINE_FEEDBACK_SOURCE_WEIGHTS: Record<PipelineFeedbackSourceType, number> = {
  [PipelineFeedbackSourceType.BOSS]: 1,
  [PipelineFeedbackSourceType.OPERATOR]: 0.7,
  [PipelineFeedbackSourceType.PERFORMANCE]: 0.45,
  [PipelineFeedbackSourceType.REJECTION]: 0.25,
}
