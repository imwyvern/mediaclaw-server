import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseAuthService } from '../../../apps/aitoearn-server/src/core/mediaclaw/auth/enterprise-auth.service'
import { McAuthController } from '../../../apps/aitoearn-server/src/core/mediaclaw/auth/auth.controller'
import { McAuthService } from '../../../apps/aitoearn-server/src/core/mediaclaw/auth/auth.service'
import {
  createMediaClawTestApp,
  testAccessToken,
  testUser,
} from './test-app.helper'

Reflect.defineMetadata('design:paramtypes', [McAuthService, EnterpriseAuthService], McAuthController)
Reflect.defineMetadata(GUARDS_METADATA, [], McAuthController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], McAuthController)

describe('MediaClaw Auth E2E', () => {
  let app: Awaited<ReturnType<typeof createMediaClawTestApp>>['app']
  let client: Awaited<ReturnType<typeof createMediaClawTestApp>>['client']

  const authService = {
    sendSmsCode: vi.fn(),
    verifySmsCode: vi.fn(),
  }

  const enterpriseAuthService = {
    registerEnterprise: vi.fn(),
    listUserOrgs: vi.fn(),
  }

  beforeAll(async () => {
    const testApp = await createMediaClawTestApp({
      controllers: [McAuthController],
      providers: [
        { provide: McAuthService, useValue: authService },
        { provide: EnterpriseAuthService, useValue: enterpriseAuthService },
      ],
    })

    app = testApp.app
    client = testApp.client
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    authService.sendSmsCode.mockResolvedValue({
      success: true,
      message: 'Code sent',
    })
    authService.verifySmsCode.mockResolvedValue({
      accessToken: testAccessToken,
      refreshToken: 'refresh-token',
      user: {
        id: testUser.id,
        orgId: testUser.orgId,
      },
      isNewUser: false,
    })
    enterpriseAuthService.registerEnterprise.mockResolvedValue({
      orgId: testUser.orgId,
      adminId: testUser.id,
      status: 'created',
    })
    enterpriseAuthService.listUserOrgs.mockResolvedValue([
      {
        orgId: testUser.orgId,
        orgName: 'MediaClaw Demo',
        role: testUser.role,
      },
    ])
  })

  it('应完成注册、登录、拿 token 并访问受保护接口', async () => {
    const registerResponse = await client
      .post('/api/v1/auth/enterprise/register')
      .send({
        orgName: 'MediaClaw Demo',
        adminPhone: '13800138000',
        code: '123456',
        adminName: '演示管理员',
      })

    expect(registerResponse.status).toBe(201)
    expect(enterpriseAuthService.registerEnterprise).toHaveBeenCalledWith({
      orgName: 'MediaClaw Demo',
      adminPhone: '13800138000',
      code: '123456',
      adminName: '演示管理员',
    })

    const sendSmsResponse = await client
      .post('/api/v1/auth/sms/send')
      .send({ phone: '13800138000' })

    expect(sendSmsResponse.status).toBe(201)
    expect(authService.sendSmsCode).toHaveBeenCalledWith('13800138000')

    const verifyResponse = await client
      .post('/api/v1/auth/sms/verify')
      .send({
        phone: '13800138000',
        code: '123456',
      })

    expect(verifyResponse.status).toBe(201)
    expect(verifyResponse.body.accessToken).toBe(testAccessToken)

    const orgsResponse = await client
      .get('/api/v1/auth/my-orgs')
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(orgsResponse.status).toBe(200)
    expect(orgsResponse.body).toEqual([
      expect.objectContaining({
        orgId: testUser.orgId,
        orgName: 'MediaClaw Demo',
      }),
    ])
    expect(enterpriseAuthService.listUserOrgs).toHaveBeenCalledWith(testUser.id)
  })
})
