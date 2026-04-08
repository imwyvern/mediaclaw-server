import { createHmac, timingSafeEqual } from 'node:crypto'

export type WebhookProvider = 'generic' | 'feishu' | 'dingtalk' | 'wecom'

export interface WebhookDeliveryEnvelope {
  event: string
  timestamp: string
  payload: Record<string, unknown>
  isTest?: boolean
}

export interface PreparedWebhookRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  provider: WebhookProvider
}

const EVENT_ALIASES: Record<string, string[]> = {
  'task.completed': ['video.completed'],
  'distribution.published': ['content.published', 'publish.callback'],
  'token.quota_warning': ['credit.low', 'quota.low', 'balance.low'],
  'token.quota_exceeded': ['credit.exceeded', 'quota.exceeded', 'balance.exceeded'],
}

const EVENT_CANONICAL_LOOKUP = Object.entries(EVENT_ALIASES).reduce<Record<string, string>>((lookup, [canonical, aliases]) => {
  lookup[canonical] = canonical
  for (const alias of aliases) {
    lookup[alias] = canonical
  }
  return lookup
}, {})

export function canonicalizeWebhookEvent(event: string) {
  const normalized = event.trim().toLowerCase()
  if (!normalized) {
    return ''
  }

  return EVENT_CANONICAL_LOOKUP[normalized] || normalized
}

export function expandWebhookEvents(event: string) {
  const canonical = canonicalizeWebhookEvent(event)
  if (!canonical) {
    return []
  }

  return [...new Set([canonical, ...(EVENT_ALIASES[canonical] || [])])]
}

export function normalizeWebhookEvents(events: string[]) {
  const normalized = [...new Set(
    (events || [])
      .map(event => canonicalizeWebhookEvent(String(event || '')))
      .filter(Boolean)
      .map(event => (event === 'all' ? '*' : event)),
  )]

  return normalized.length > 0 ? normalized : ['*']
}

export function detectWebhookProvider(url: string): WebhookProvider {
  try {
    const host = new URL(url).host.toLowerCase()

    if (
      host.includes('open.feishu.cn')
      || host.includes('feishu.cn')
      || host.includes('larksuite.com')
      || host.includes('larkoffice.com')
    ) {
      return 'feishu'
    }

    if (host.includes('dingtalk.com')) {
      return 'dingtalk'
    }

    if (
      host.includes('qyapi.weixin.qq.com')
      || host.includes('wecom')
      || host.includes('weixin.qq.com')
    ) {
      return 'wecom'
    }
  }
  catch {
    return 'generic'
  }

  return 'generic'
}

export function signGenericWebhook(rawBody: string, timestamp: string, secret: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

export function verifyGenericWebhookSignature(
  rawBody: string,
  timestamp: string,
  secret: string,
  signature: string,
) {
  if (!secret || !signature) {
    return false
  }

  const expected = Buffer.from(signGenericWebhook(rawBody, timestamp, secret), 'utf8')
  const actual = Buffer.from(signature, 'utf8')

  if (expected.length !== actual.length) {
    return false
  }

  return timingSafeEqual(expected, actual)
}

export function buildWebhookRequest(
  url: string,
  secret: string,
  envelope: WebhookDeliveryEnvelope,
): PreparedWebhookRequest {
  const provider = detectWebhookProvider(url)

  switch (provider) {
    case 'feishu':
      return buildFeishuRequest(url, secret, envelope)
    case 'dingtalk':
      return buildDingtalkRequest(url, secret, envelope)
    case 'wecom':
      return buildWecomRequest(url, envelope)
    default:
      return buildGenericRequest(url, secret, envelope)
  }
}

function buildGenericRequest(
  url: string,
  secret: string,
  envelope: WebhookDeliveryEnvelope,
): PreparedWebhookRequest {
  const body = {
    event: envelope.event,
    timestamp: envelope.timestamp,
    payload: envelope.payload,
    isTest: envelope.isTest ?? false,
  }
  const rawBody = JSON.stringify(body)
  const signature = secret
    ? signGenericWebhook(rawBody, envelope.timestamp, secret)
    : ''

  return {
    provider: 'generic',
    url,
    headers: {
      'content-type': 'application/json',
      'x-mediaclaw-event': envelope.event,
      'x-mediaclaw-timestamp': envelope.timestamp,
      'x-mediaclaw-signature': signature,
      'x-mediaclaw-signature-version': 'hmac-sha256',
    },
    body,
  }
}

function buildFeishuRequest(
  url: string,
  secret: string,
  envelope: WebhookDeliveryEnvelope,
): PreparedWebhookRequest {
  const timestamp = Math.floor(Date.now() / 1000)
  const text = buildMessageText(envelope)
  const body: Record<string, unknown> = {
    msg_type: 'text',
    content: {
      text,
    },
  }

  if (secret) {
    body['timestamp'] = timestamp
    body['sign'] = createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64')
  }

  return {
    provider: 'feishu',
    url,
    headers: {
      'content-type': 'application/json',
    },
    body,
  }
}

function buildDingtalkRequest(
  rawUrl: string,
  secret: string,
  envelope: WebhookDeliveryEnvelope,
): PreparedWebhookRequest {
  const timestamp = Date.now().toString()
  const markdown = buildMarkdownMessage(envelope)
  const url = appendDingtalkSignature(rawUrl, timestamp, secret)

  return {
    provider: 'dingtalk',
    url,
    headers: {
      'content-type': 'application/json',
    },
    body: {
      msgtype: 'markdown',
      markdown: {
        title: `MediaClaw 事件: ${envelope.event}`,
        text: markdown,
      },
    },
  }
}

function buildWecomRequest(
  url: string,
  envelope: WebhookDeliveryEnvelope,
): PreparedWebhookRequest {
  return {
    provider: 'wecom',
    url,
    headers: {
      'content-type': 'application/json',
    },
    body: {
      msgtype: 'markdown',
      markdown: {
        content: buildMarkdownMessage(envelope),
      },
    },
  }
}

function appendDingtalkSignature(rawUrl: string, timestamp: string, secret: string) {
  if (!secret) {
    return rawUrl
  }

  const url = new URL(rawUrl)
  const sign = createHmac('sha256', secret)
    .update(`${timestamp}\n${secret}`)
    .digest('base64')

  url.searchParams.set('timestamp', timestamp)
  url.searchParams.set('sign', sign)
  return url.toString()
}

function buildMessageText(envelope: WebhookDeliveryEnvelope) {
  return [
    `MediaClaw 事件通知`,
    `事件: ${envelope.event}`,
    `时间: ${envelope.timestamp}`,
    `测试投递: ${envelope.isTest ? '是' : '否'}`,
    `数据: ${JSON.stringify(envelope.payload)}`,
  ].join('\n')
}

function buildMarkdownMessage(envelope: WebhookDeliveryEnvelope) {
  return [
    `# MediaClaw 事件通知`,
    `- 事件：${envelope.event}`,
    `- 时间：${envelope.timestamp}`,
    `- 测试投递：${envelope.isTest ? '是' : '否'}`,
    `- 数据：\`${JSON.stringify(envelope.payload)}\``,
  ].join('\n')
}
