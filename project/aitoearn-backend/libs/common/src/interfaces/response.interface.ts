export interface CommonResponse<T> {
  data?: T
  code: number
  message: string
  timestamp?: number
}

export interface MediaClawApiError {
  code: number | string
  message: string
  details?: unknown
}

export interface MediaClawApiMeta {
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
  [key: string]: unknown
}

export interface MediaClawApiResponse<T> {
  success: boolean
  data: T | null
  error: MediaClawApiError | null
  meta?: MediaClawApiMeta
}
