import axios from 'axios'
import { Types } from 'mongoose'
import { WebhookService } from './webhook.service'

vi.mock('@yikart/mongodb', () => ({
  Webhook: class Webhook {},
}))

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    isAxiosError: (value: unknown) => Boolean((value as Record<string, unknown> | undefined)?.['isAxiosError']),
  },
}))

describe('webhookService behavior', () => {
  const axiosMock = vi.mocked(axios, true)
  const orgId = new Types.ObjectId().toString()

  let webhookModel: Record<string, any>
  let service: WebhookService

  beforeEach(() => {
    webhookModel = {
      create: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      findOneAndDelete: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    service = new WebhookService(webhookModel as any)
    vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined)
    axiosMock.post.mockReset()
  })

  it('应在注册时默认订阅全部事件并返回 provider', async () => {
    const webhookId = new Types.ObjectId()
    webhookModel.create.mockResolvedValue({
      toObject: () => ({
        _id: webhookId,
        orgId: new Types.ObjectId(orgId),
        name: 'Webhook example.com',
        url: 'https://example.com/hooks',
        secret: 'secret',
        events: ['*'],
        isActive: true,
        lastTriggeredAt: null,
        failCount: 0,
      }),
    })

    const result = await service.register(orgId, 'https://example.com/hooks', [])

    expect(webhookModel.create).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/hooks',
      events: ['*'],
    }))
    expect(result.provider).toBe('generic')
    expect(result.events).toEqual(['*'])
  })

  it('应对通用 webhook 执行指数退避重试并附带可验证签名', async () => {
    const webhook = {
      _id: new Types.ObjectId(),
      orgId: new Types.ObjectId(orgId),
      name: 'Generic',
      url: 'https://example.com/hooks',
      secret: 'secret',
      events: ['task.completed'],
      isActive: true,
    }

    webhookModel.find.mockReturnValue({
      lean: () => ({
        exec: vi.fn().mockResolvedValue([webhook]),
      }),
    })
    webhookModel.findByIdAndUpdate.mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    })

    axiosMock.post
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ status: 200 })

    const result = await service.trigger('video.completed', {
      orgId,
      taskId: 'task_1',
    })

    expect(axiosMock.post).toHaveBeenCalledTimes(3)
    const thirdCall = axiosMock.post.mock.calls[2]
    const rawBody = JSON.stringify(thirdCall[1])
    const headers = thirdCall[2]?.['headers'] as Record<string, string>

    expect(service.verifySignature(
      rawBody,
      headers['x-mediaclaw-timestamp'],
      headers['x-mediaclaw-signature'],
      webhook.secret,
    )).toBe(true)
    expect(result.successCount).toBe(1)
    expect(result.results[0]).toEqual(expect.objectContaining({
      provider: 'generic',
      success: true,
      attempts: 3,
    }))
  })

  it('应支持指定 webhook 的测试投递', async () => {
    const webhook = {
      _id: new Types.ObjectId(),
      orgId: new Types.ObjectId(orgId),
      name: 'Feishu',
      url: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
      secret: 'secret',
      events: ['task.completed'],
      isActive: true,
    }

    webhookModel.findOne.mockReturnValue({
      lean: () => ({
        exec: vi.fn().mockResolvedValue(webhook),
      }),
    })
    webhookModel.findByIdAndUpdate.mockReturnValue({
      exec: vi.fn().mockResolvedValue(null),
    })
    axiosMock.post.mockResolvedValue({ status: 200 })

    const result = await service.testDelivery(orgId, webhook._id.toString(), 'task.completed', {
      taskId: 'task_1',
    })

    expect(axiosMock.post).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expect.objectContaining({
      provider: 'feishu',
      success: true,
      attempts: 1,
      event: 'task.completed',
    }))
  })
})
