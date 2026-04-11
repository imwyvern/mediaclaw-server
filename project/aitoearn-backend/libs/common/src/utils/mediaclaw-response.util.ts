import type { CommonResponse, MediaClawApiMeta, MediaClawApiResponse } from '../interfaces'

const MEDIA_CLAW_META_KEYS = ['page', 'pageSize', 'total', 'totalPages'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function buildMeta(record: Record<string, unknown>) {
  const meta: MediaClawApiMeta = {}

  for (const key of MEDIA_CLAW_META_KEYS) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      meta[key] = value
    }
  }

  return Object.keys(meta).length > 0 ? meta : undefined
}

function stripMeta(record: Record<string, unknown>) {
  return Object.entries(record).reduce<Record<string, unknown>>((accumulator, [key, value]) => {
    if (!MEDIA_CLAW_META_KEYS.includes(key as typeof MEDIA_CLAW_META_KEYS[number])) {
      accumulator[key] = value
    }
    return accumulator
  }, {})
}

function normalizeSuccessData(data: unknown) {
  if (!isRecord(data)) {
    return {
      data: data ?? null,
      meta: undefined,
    }
  }

  const meta = buildMeta(data)
  if (!meta) {
    return {
      data,
      meta: undefined,
    }
  }

  const normalized = stripMeta(data)
  if ('list' in normalized && Object.keys(normalized).length === 1) {
    return {
      data: normalized['list'],
      meta,
    }
  }

  if ('items' in normalized && Object.keys(normalized).length === 1) {
    return {
      data: normalized['items'],
      meta,
    }
  }

  return {
    data: normalized,
    meta,
  }
}

export function buildMediaClawSuccessResponse<T>(payload: T): MediaClawApiResponse<T> {
  if (isMediaClawApiResponse(payload)) {
    return payload as MediaClawApiResponse<T>
  }

  const normalized = normalizeSuccessData(payload)
  return {
    success: true,
    data: normalized.data as T,
    error: null,
    ...(normalized.meta ? { meta: normalized.meta } : {}),
  }
}

export function buildMediaClawErrorResponse(payload: CommonResponse<unknown>): MediaClawApiResponse<null> {
  const details = payload.data && Object.keys(payload.data as Record<string, unknown>).length > 0
    ? payload.data
    : undefined

  return {
    success: false,
    data: null,
    error: {
      code: payload.code,
      message: payload.message,
      ...(details !== undefined ? { details } : {}),
    },
  }
}

export function isMediaClawApiResponse<T>(value: unknown): value is MediaClawApiResponse<T> {
  return isRecord(value)
    && typeof value['success'] === 'boolean'
    && 'data' in value
    && 'error' in value
}
