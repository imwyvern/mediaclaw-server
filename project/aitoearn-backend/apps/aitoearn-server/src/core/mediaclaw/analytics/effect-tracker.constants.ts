export const MEDIACLAW_EFFECT_TRACKER_QUEUE = 'mediaclaw-effect-tracker'
export const EFFECT_TRACKER_JOB_COLLECT = 'analytics.effect-track'

export type EffectTrackerCohort = 't0_3' | 't4_7' | 't8_30' | 't31_90'

export interface EffectTrackerJobData {
  cohort: EffectTrackerCohort
  trigger?: string
  source?: string
  requestedAt?: string
}

export interface EffectTrackerCohortWindow {
  cohort: EffectTrackerCohort
  minDays: number
  maxDays: number
  label: string
  cron: string
  schedulerId: string
}

export const EFFECT_TRACKER_COHORT_WINDOWS: EffectTrackerCohortWindow[] = [
  {
    cohort: 't0_3',
    minDays: 0,
    maxDays: 3,
    label: 'T+0~3',
    cron: '0 9,21 * * *',
    schedulerId: 'mediaclaw-effect-tracker-t0-3',
  },
  {
    cohort: 't4_7',
    minDays: 4,
    maxDays: 7,
    label: 'T+4~7',
    cron: '0 10 * * *',
    schedulerId: 'mediaclaw-effect-tracker-t4-7',
  },
  {
    cohort: 't8_30',
    minDays: 8,
    maxDays: 30,
    label: 'T+8~30',
    cron: '0 11 */3 * *',
    schedulerId: 'mediaclaw-effect-tracker-t8-30',
  },
  {
    cohort: 't31_90',
    minDays: 31,
    maxDays: 90,
    label: 'T+31~90',
    cron: '0 12 * * 1',
    schedulerId: 'mediaclaw-effect-tracker-t31-90',
  },
]

export function getEffectTrackerWindow(cohort: EffectTrackerCohort) {
  return EFFECT_TRACKER_COHORT_WINDOWS.find(item => item.cohort === cohort) || null
}
