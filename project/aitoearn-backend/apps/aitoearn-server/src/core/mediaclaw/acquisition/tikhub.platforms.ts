export const SUPPORTED_TIKHUB_PLATFORMS = [
  'douyin',
  'xhs',
  'kuaishou',
  'bilibili',
] as const

export type TikHubPlatform = typeof SUPPORTED_TIKHUB_PLATFORMS[number]
