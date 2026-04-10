import type { Aggregate, Query, Schema } from 'mongoose'
import { EventEmitter } from 'node:events'

const SLOW_QUERY_EVENT = 'slow-query'
const START_TIME = Symbol('mediaclawMongoSlowQueryStartedAt')

const QUERY_HOOKS = [
  'find',
  'findOne',
  'countDocuments',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndDelete',
] as const

export interface MongoSlowQueryEvent {
  modelName: string
  collectionName: string
  operation: string
  durationMs: number
  filter?: unknown
  pipeline?: unknown[]
  options?: unknown
  timestamp: string
}

const slowQueryEmitter = new EventEmitter()
let slowQueryThresholdMs = 300

export function configureMongoSlowQueryMonitor(thresholdMs?: number) {
  if (Number.isFinite(thresholdMs) && Number(thresholdMs) > 0) {
    slowQueryThresholdMs = Math.floor(Number(thresholdMs))
  }
}

export function onMongoSlowQuery(listener: (event: MongoSlowQueryEvent) => void) {
  slowQueryEmitter.on(SLOW_QUERY_EVENT, listener)
  return () => slowQueryEmitter.off(SLOW_QUERY_EVENT, listener)
}

export function createMongoSlowQueryPlugin() {
  return (schema: Schema) => {
    for (const hook of QUERY_HOOKS) {
      schema.pre(hook, function captureStartedAt() {
        setStartedAt(this)
      })

      schema.post(hook, function emitSlowQuery() {
        emitQueryIfSlow(hook, this as Query<unknown, unknown>)
      })
    }

    schema.pre('aggregate', function captureAggregateStartedAt() {
      setStartedAt(this)
    })

    schema.post('aggregate', function emitAggregateSlowQuery() {
      emitAggregateIfSlow(this as Aggregate<unknown[]>)
    })
  }
}

function emitQueryIfSlow(operation: string, query: Query<unknown, unknown>) {
  const durationMs = resolveDurationMs(query)
  if (durationMs < slowQueryThresholdMs) {
    return
  }

  emitSlowQuery({
    modelName: query.model.modelName,
    collectionName: query.model.collection?.collectionName || query.model.modelName,
    operation,
    durationMs,
    filter: normalizePayload(query.getFilter?.()),
    options: normalizePayload(query.getOptions?.()),
    timestamp: new Date().toISOString(),
  })
}

function emitAggregateIfSlow(aggregate: Aggregate<unknown[]>) {
  const durationMs = resolveDurationMs(aggregate)
  if (durationMs < slowQueryThresholdMs) {
    return
  }

  emitSlowQuery({
    modelName: aggregate.model()?.modelName || 'aggregate',
    collectionName: aggregate.model()?.collection?.collectionName || 'aggregate',
    operation: 'aggregate',
    durationMs,
    pipeline: normalizePayload(aggregate.pipeline?.()) as unknown[],
    options: normalizePayload(aggregate.options || {}),
    timestamp: new Date().toISOString(),
  })
}

function emitSlowQuery(event: MongoSlowQueryEvent) {
  slowQueryEmitter.emit(SLOW_QUERY_EVENT, event)
}

function setStartedAt(target: object) {
  Reflect.set(target, START_TIME, Date.now())
}

function resolveDurationMs(target: object) {
  const startedAt = Number(Reflect.get(target, START_TIME) || 0)
  return startedAt > 0 ? Math.max(1, Date.now() - startedAt) : 0
}

function normalizePayload(value: unknown) {
  if (value == null) {
    return value
  }

  const serialized = JSON.stringify(value)
  if (!serialized) {
    return value
  }

  if (serialized.length <= 2000) {
    return value
  }

  return {
    truncated: true,
    preview: serialized.slice(0, 2000),
  }
}
