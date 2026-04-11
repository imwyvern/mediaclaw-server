export const API_CONTRACT_METADATA_KEY = 'api:contract'
export const DEPRECATED_ROUTE_METADATA_KEY = 'api:deprecated-route'

export const API_CONTRACT_TYPES = {
  COMMON: 'common',
  MEDIACLAW_V1: 'mediaclaw-v1',
} as const

export type ApiContractType = typeof API_CONTRACT_TYPES[keyof typeof API_CONTRACT_TYPES]
