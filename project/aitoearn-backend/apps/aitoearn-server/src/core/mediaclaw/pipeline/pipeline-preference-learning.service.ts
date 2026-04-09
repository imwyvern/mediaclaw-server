import { Injectable } from '@nestjs/common'
import {
  PIPELINE_FEEDBACK_SOURCE_WEIGHTS,
  PipelineFeedbackSourceType,
} from './pipeline-feedback.constants'

interface PipelineFeedbackEntry {
  id: string
  sourceType: PipelineFeedbackSourceType
  weight: number
  note: string
  preferredStyles: string[]
  avoidStyles: string[]
  preferredPlatforms: string[]
  preferredCategories: string[]
  preferredDuration: number | null
  aspectRatio: string
  tone: string
  visualStyle: string
  performanceData: Record<string, number>
  rejectionReason: string
  createdAt: string
}

@Injectable()
export class PipelinePreferenceLearningService {
  createFeedbackEntry(input: Record<string, any>) {
    const sourceType = this.normalizeSourceType(input['sourceType'])
    return {
      id: this.createEntryId(),
      sourceType,
      weight: PIPELINE_FEEDBACK_SOURCE_WEIGHTS[sourceType],
      note: this.normalizeOptionalString(input['note']),
      preferredStyles: this.normalizeStringList(input['preferredStyles']),
      avoidStyles: this.normalizeStringList(input['avoidStyles']),
      preferredPlatforms: this.normalizeStringList(input['preferredPlatforms']),
      preferredCategories: this.normalizeStringList(input['preferredCategories']),
      preferredDuration: this.normalizePositiveNumber(input['preferredDuration']),
      aspectRatio: this.normalizeOptionalString(input['aspectRatio']),
      tone: this.normalizeOptionalString(input['tone']),
      visualStyle: this.normalizeOptionalString(input['visualStyle']),
      performanceData: this.normalizePerformanceData(input['performanceData']),
      rejectionReason: this.normalizeOptionalString(input['rejectionReason']),
      createdAt: new Date().toISOString(),
    } satisfies PipelineFeedbackEntry
  }

  buildLearnedState(
    currentPreferences: Record<string, any>,
    currentStyleConfig: Record<string, any>,
    currentDistributionRules: Record<string, any>,
    feedbackLog: Array<Record<string, any>>,
  ) {
    const normalizedFeedbackLog = feedbackLog.map(item => this.normalizeFeedbackEntry(item))
    const preferredPlatforms = this.mergeRankedWithCurrent(
      this.rankWeightedValues(normalizedFeedbackLog, 'preferredPlatforms'),
      currentDistributionRules['preferredPlatforms'],
    )
    const preferredCategories = this.mergeRankedWithCurrent(
      this.rankWeightedValues(normalizedFeedbackLog, 'preferredCategories'),
      currentDistributionRules['preferredCategories'],
    )
    const preferredStylesWeighted = this.rankWeightedValues(normalizedFeedbackLog, 'preferredStyles')
    const avoidStylesWeighted = this.rankWeightedValues(normalizedFeedbackLog, 'avoidStyles')
    const preferredDuration = this.resolveWeightedAverage(normalizedFeedbackLog, 'preferredDuration')
    const aspectRatio = this.resolveWeightedMode(normalizedFeedbackLog, 'aspectRatio')
    const tone = this.resolveWeightedMode(normalizedFeedbackLog, 'tone')
    const visualStyle = this.resolveWeightedMode(normalizedFeedbackLog, 'visualStyle')
    const rejectionReasons = this.rankWeightedReasons(normalizedFeedbackLog)
    const performanceSignals = this.aggregatePerformanceSignals(normalizedFeedbackLog)
    const feedbackSources = normalizedFeedbackLog.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.sourceType] = (acc[entry.sourceType] || 0) + 1
      return acc
    }, {})
    const lastFeedbackAt = normalizedFeedbackLog.length > 0
      ? normalizedFeedbackLog[normalizedFeedbackLog.length - 1]?.createdAt || null
      : null

    const preferenceLearning = {
      feedbackSources,
      sourceWeights: PIPELINE_FEEDBACK_SOURCE_WEIGHTS,
      preferredStyles: preferredStylesWeighted,
      avoidStyles: avoidStylesWeighted,
      preferredPlatforms,
      preferredCategories,
      preferredDuration: preferredDuration ?? Number(currentPreferences['preferredDuration'] || currentStyleConfig['duration'] || 15),
      aspectRatio: aspectRatio || this.normalizeOptionalString(currentPreferences['aspectRatio']) || this.normalizeOptionalString(currentStyleConfig['aspectRatio']) || '9:16',
      tone: tone || this.normalizeOptionalString(currentStyleConfig['tone']),
      visualStyle: visualStyle || this.normalizeOptionalString(currentStyleConfig['visualStyle']),
      rejectionReasons,
      performanceSignals,
      lastFeedbackAt,
    }

    return {
      preferences: {
        ...currentPreferences,
        preferredStyles: preferredStylesWeighted.length > 0 ? preferredStylesWeighted : this.normalizeStringList(currentPreferences['preferredStyles']),
        avoidStyles: avoidStylesWeighted.length > 0 ? avoidStylesWeighted : this.normalizeStringList(currentPreferences['avoidStyles']),
        preferredDuration: preferredDuration ?? Number(currentPreferences['preferredDuration'] || currentStyleConfig['duration'] || 15),
        aspectRatio: aspectRatio || this.normalizeOptionalString(currentPreferences['aspectRatio']) || this.normalizeOptionalString(currentStyleConfig['aspectRatio']) || '9:16',
        feedbackCount: normalizedFeedbackLog.length,
        feedbackLog: normalizedFeedbackLog,
        preferenceLearning,
        lastFeedbackAt,
      },
      styleConfig: {
        ...currentStyleConfig,
        tone: tone || this.normalizeOptionalString(currentStyleConfig['tone']),
        visualStyle: visualStyle || this.normalizeOptionalString(currentStyleConfig['visualStyle']),
      },
      distributionRules: {
        ...currentDistributionRules,
        preferredPlatforms,
        preferredCategories,
      },
      preferenceLearning,
    }
  }

  private normalizeSourceType(value: unknown) {
    if (typeof value === 'string' && value in PIPELINE_FEEDBACK_SOURCE_WEIGHTS) {
      return value as PipelineFeedbackSourceType
    }

    return PipelineFeedbackSourceType.OPERATOR
  }

  private normalizeOptionalString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private normalizeStringList(value: unknown) {
    return Array.from(new Set(
      (Array.isArray(value) ? value : [])
        .map(item => this.normalizeOptionalString(item))
        .filter(Boolean),
    ))
  }

  private normalizePositiveNumber(value: unknown) {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null
  }

  private normalizePerformanceData(value: unknown) {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}

    return Object.entries(record).reduce<Record<string, number>>((acc, [key, rawValue]) => {
      const numeric = Number(rawValue)
      if (Number.isFinite(numeric)) {
        acc[key] = numeric
      }
      return acc
    }, {})
  }

  private rankWeightedValues(
    feedbackLog: PipelineFeedbackEntry[],
    key: 'preferredStyles' | 'avoidStyles' | 'preferredPlatforms' | 'preferredCategories',
  ) {
    const scores = feedbackLog.reduce<Map<string, number>>((acc, entry) => {
      for (const item of entry[key]) {
        acc.set(item, (acc.get(item) || 0) + entry.weight)
      }
      return acc
    }, new Map<string, number>())

    return Array.from(scores.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([value]) => value)
      .slice(0, 5)
  }

  private resolveWeightedAverage(
    feedbackLog: PipelineFeedbackEntry[],
    key: 'preferredDuration',
  ) {
    let weightedValue = 0
    let totalWeight = 0

    for (const entry of feedbackLog) {
      const value = entry[key]
      if (!value) {
        continue
      }
      weightedValue += value * entry.weight
      totalWeight += entry.weight
    }

    if (totalWeight === 0) {
      return null
    }

    return Math.max(1, Math.round(weightedValue / totalWeight))
  }

  private resolveWeightedMode(
    feedbackLog: PipelineFeedbackEntry[],
    key: 'aspectRatio' | 'tone' | 'visualStyle',
  ) {
    const scores = feedbackLog.reduce<Map<string, number>>((acc, entry) => {
      const value = this.normalizeOptionalString(entry[key])
      if (!value) {
        return acc
      }

      acc.set(value, (acc.get(value) || 0) + entry.weight)
      return acc
    }, new Map<string, number>())

    return Array.from(scores.entries())
      .sort((left, right) => right[1] - left[1])[0]?.[0] || ''
  }

  private rankWeightedReasons(feedbackLog: PipelineFeedbackEntry[]) {
    const scores = feedbackLog.reduce<Map<string, number>>((acc, entry) => {
      const value = this.normalizeOptionalString(entry.rejectionReason)
      if (!value) {
        return acc
      }

      acc.set(value, (acc.get(value) || 0) + entry.weight)
      return acc
    }, new Map<string, number>())

    return Array.from(scores.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([reason, weight]) => ({ reason, weight }))
      .slice(0, 5)
  }

  private aggregatePerformanceSignals(feedbackLog: PipelineFeedbackEntry[]) {
    const signalScores = new Map<string, { total: number, count: number }>()

    for (const entry of feedbackLog) {
      for (const [key, value] of Object.entries(entry.performanceData || {})) {
        const current = signalScores.get(key) || { total: 0, count: 0 }
        current.total += value * entry.weight
        current.count += entry.weight
        signalScores.set(key, current)
      }
    }

    return Array.from(signalScores.entries()).reduce<Record<string, number>>((acc, [key, state]) => {
      if (state.count > 0) {
        acc[key] = Number((state.total / state.count).toFixed(4))
      }
      return acc
    }, {})
  }

  private createEntryId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }

  private mergeRankedWithCurrent(ranked: string[], current: unknown) {
    return Array.from(new Set([
      ...ranked,
      ...this.normalizeStringList(current),
    ]))
  }

  private normalizeFeedbackEntry(value: Record<string, any>) {
    const sourceType = this.normalizeSourceType(value['sourceType'])
    return {
      id: this.normalizeOptionalString(value['id']) || this.createEntryId(),
      sourceType,
      weight: this.normalizePositiveNumber(value['weight']) || PIPELINE_FEEDBACK_SOURCE_WEIGHTS[sourceType],
      note: this.normalizeOptionalString(value['note']),
      preferredStyles: this.normalizeStringList(value['preferredStyles']),
      avoidStyles: this.normalizeStringList(value['avoidStyles']),
      preferredPlatforms: this.normalizeStringList(value['preferredPlatforms']),
      preferredCategories: this.normalizeStringList(value['preferredCategories']),
      preferredDuration: this.normalizePositiveNumber(value['preferredDuration']),
      aspectRatio: this.normalizeOptionalString(value['aspectRatio']),
      tone: this.normalizeOptionalString(value['tone']),
      visualStyle: this.normalizeOptionalString(value['visualStyle']),
      performanceData: this.normalizePerformanceData(value['performanceData']),
      rejectionReason: this.normalizeOptionalString(value['rejectionReason']),
      createdAt: this.normalizeOptionalString(value['createdAt']) || new Date().toISOString(),
    } satisfies PipelineFeedbackEntry
  }
}
