export const MEDIA_CLAW_API_KEY_ENVIRONMENTS = ['live', 'test'] as const

export type MediaClawApiKeyEnvironment = (typeof MEDIA_CLAW_API_KEY_ENVIRONMENTS)[number]

const MEDIA_CLAW_API_KEY_SCOPE_REGEX = '[a-z][a-z0-9-]{1,31}'
const MEDIA_CLAW_API_KEY_REGEX = new RegExp(`^mc_(${MEDIA_CLAW_API_KEY_SCOPE_REGEX})_[a-z0-9]+$`, 'i')
const MEDIA_CLAW_API_KEY_PREFIX_REGEX = new RegExp(`^(mc_${MEDIA_CLAW_API_KEY_SCOPE_REGEX}_[a-z0-9]{8})`, 'i')
const MEDIA_CLAW_API_KEY_PREFIX_ONLY_REGEX = new RegExp(`^(mc_${MEDIA_CLAW_API_KEY_SCOPE_REGEX}_)`, 'i')

export function normalizeMediaClawApiKeyEnvironment(
  value?: string | null,
): MediaClawApiKeyEnvironment {
  return value?.trim().toLowerCase() === 'test' ? 'test' : 'live'
}

export function isMediaClawApiKey(value?: string | null): value is string {
  return typeof value === 'string' && MEDIA_CLAW_API_KEY_REGEX.test(value.trim())
}

export function buildMediaClawApiKey(
  secret: string,
  environment: MediaClawApiKeyEnvironment,
) {
  return `mc_${environment}_${secret}`
}

export function buildMediaClawApiKeyPrefix(
  secret: string,
  environment: MediaClawApiKeyEnvironment,
) {
  return `mc_${environment}_${secret.slice(0, 8)}`
}

export function extractMediaClawApiKeyPrefix(rawKey?: string | null) {
  if (!rawKey) {
    return undefined
  }

  const match = rawKey.trim().match(MEDIA_CLAW_API_KEY_PREFIX_REGEX)
  return match?.[1]
}

export function maskMediaClawApiKeyPrefix(prefix?: string | null) {
  if (!prefix) {
    return 'mc_live_****************************'
  }

  const trimmed = prefix.trim()
  const suffix = trimmed.slice(-4) || '****'
  const prefixMatch = trimmed.match(MEDIA_CLAW_API_KEY_PREFIX_ONLY_REGEX)
  const environmentPrefix = prefixMatch?.[1] || 'mc_live_'

  return `${environmentPrefix}************************${suffix}`
}
