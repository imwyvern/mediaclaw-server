import type {
  ContentReviewerInput,
  ContentReviewerOutput,
  ComplianceCheck,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const BANNED_WORDS = [
  '最好', '第一', '国家级', '顶级', '极品', '万能', '祖传', '秘方',
  '100%', '绝对', '永久', '无副作用', '包治', '根治',
]

const SENSITIVE_WORDS = ['政治', '赌博', '色情', '暴力', '毒品']

/**
 * 内容合规审核 Tool
 */
export async function contentReviewer(
  input: ContentReviewerInput,
): Promise<ContentReviewerOutput> {
  const startMs = Date.now()
  const text = [input.title ?? '', input.description ?? '', ...(input.hashtags ?? [])].join(' ')

  const violations: string[] = []
  const warnings: string[] = []

  for (const word of BANNED_WORDS) {
    if (text.includes(word)) violations.push(`违禁广告用语: "${word}"`)
  }
  for (const word of SENSITIVE_WORDS) {
    if (text.includes(word)) violations.push(`敏感内容: "${word}"`)
  }
  if (text.length > 500) warnings.push('文案超过 500 字，建议精简')

  const compliant = violations.length === 0
  const compliance: ComplianceCheck = { passed: compliant, warnings, violations }

  // 清洗后的 copy
  let sanitizedCopy: ContentReviewerOutput['sanitizedCopy']
  if (!compliant) {
    let cleanTitle = input.title ?? ''
    let cleanDesc = input.description ?? ''
    for (const word of [...BANNED_WORDS, ...SENSITIVE_WORDS]) {
      cleanTitle = cleanTitle.replaceAll(word, '***')
      cleanDesc = cleanDesc.replaceAll(word, '***')
    }
    sanitizedCopy = { title: cleanTitle, description: cleanDesc, hashtags: input.hashtags }
  }

  const meta: ToolResponseMeta = {
    status: compliant ? 'success' : 'failed',
    errorCode: compliant ? 'NONE' : 'CONTENT_VIOLATION',
    retryable: false, confidence: 0.9, costYuan: 0,
    humanReviewRequired: violations.length > 0,
    sideEffects: [`${violations.length} 个违规`, `${warnings.length} 个警告`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { compliance, sanitizedCopy, meta }
}
