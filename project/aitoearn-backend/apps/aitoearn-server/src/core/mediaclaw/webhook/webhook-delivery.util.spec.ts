import {
  buildWebhookRequest,
  canonicalizeWebhookEvent,
  detectWebhookProvider,
  expandWebhookEvents,
  normalizeWebhookEvents,
  verifyGenericWebhookSignature,
} from './webhook-delivery.util'

describe('webhook-delivery.util', () => {
  it('应规范化事件别名并默认订阅全部事件', () => {
    expect(canonicalizeWebhookEvent('video.completed')).toBe('task.completed')
    expect(expandWebhookEvents('publish.callback')).toContain('distribution.published')
    expect(normalizeWebhookEvents([])).toEqual(['*'])
    expect(normalizeWebhookEvents(['credit.low', 'video.completed'])).toEqual([
      'token.quota_warning',
      'task.completed',
    ])
  })

  it('应构建带签名的通用 webhook 请求', () => {
    const request = buildWebhookRequest('https://example.com/hooks', 'secret', {
      event: 'task.completed',
      timestamp: '2026-04-08T12:00:00.000Z',
      payload: { orgId: 'org_1', taskId: 'task_1' },
    })

    const rawBody = JSON.stringify(request.body)
    expect(request.provider).toBe('generic')
    expect(request.headers['x-mediaclaw-signature-version']).toBe('hmac-sha256')
    expect(
      verifyGenericWebhookSignature(
        rawBody,
        request.headers['x-mediaclaw-timestamp'],
        'secret',
        request.headers['x-mediaclaw-signature'],
      ),
    ).toBe(true)
  })

  it('应识别飞书、钉钉和企微 webhook 并构建对应负载', () => {
    const envelope = {
      event: 'distribution.published',
      timestamp: '2026-04-08T12:00:00.000Z',
      payload: { orgId: 'org_1', contentId: 'content_1' },
      isTest: true,
    }

    const feishuRequest = buildWebhookRequest('https://open.feishu.cn/open-apis/bot/v2/hook/abc', 'secret', envelope)
    expect(detectWebhookProvider('https://open.feishu.cn/open-apis/bot/v2/hook/abc')).toBe('feishu')
    expect(feishuRequest.provider).toBe('feishu')
    expect(feishuRequest.body['msg_type']).toBe('text')
    expect(feishuRequest.body['sign']).toBeTypeOf('string')

    const dingtalkRequest = buildWebhookRequest('https://oapi.dingtalk.com/robot/send?access_token=abc', 'secret', envelope)
    expect(detectWebhookProvider('https://oapi.dingtalk.com/robot/send?access_token=abc')).toBe('dingtalk')
    expect(dingtalkRequest.provider).toBe('dingtalk')
    expect(dingtalkRequest.url).toContain('timestamp=')
    expect(dingtalkRequest.url).toContain('sign=')
    expect(dingtalkRequest.body['msgtype']).toBe('markdown')

    const wecomRequest = buildWebhookRequest('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc', '', envelope)
    expect(detectWebhookProvider('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc')).toBe('wecom')
    expect(wecomRequest.provider).toBe('wecom')
    expect(wecomRequest.body['msgtype']).toBe('markdown')
  })
})
