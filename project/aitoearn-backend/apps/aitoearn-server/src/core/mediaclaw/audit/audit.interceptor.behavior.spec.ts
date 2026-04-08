import { Types } from 'mongoose'
import { lastValueFrom, of } from 'rxjs'
import { vi } from 'vitest'
import { AuditInterceptor } from './audit.interceptor'

describe('auditInterceptor behavior', () => {
  it('应对下载操作记录业务化审计动作', async () => {
    const auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    }
    const interceptor = new AuditInterceptor(auditService as any)
    const request = {
      method: 'GET',
      baseUrl: '/api/v1/content',
      route: { path: ':id/download' },
      originalUrl: '/api/v1/content/task-1/download',
      url: '/api/v1/content/task-1/download',
      params: { id: 'task-1' },
      query: {},
      body: {},
      headers: { 'user-agent': 'vitest' },
      ip: '10.0.0.1',
      user: {
        id: new Types.ObjectId().toString(),
        orgId: new Types.ObjectId().toString(),
      },
    }
    const response = { statusCode: 302 }
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    }
    const next = {
      handle: () => of('ok'),
    }

    await lastValueFrom(interceptor.intercept(context as any, next as any))

    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'content.download',
      resource: 'content',
      resourceId: 'task-1',
      target: 'task-1',
      ip: '10.0.0.1',
    }))
  })

  it('应对企业邀请记录明确的成员邀请动作', async () => {
    const auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    }
    const interceptor = new AuditInterceptor(auditService as any)
    const request = {
      method: 'POST',
      baseUrl: '/api/v1/org',
      route: { path: 'members/invite' },
      originalUrl: '/api/v1/org/members/invite',
      url: '/api/v1/org/members/invite',
      params: {},
      query: {},
      body: {
        phone: '13800138000',
        role: 'editor',
      },
      headers: { 'user-agent': 'vitest' },
      ip: '10.0.0.2',
      user: {
        id: new Types.ObjectId().toString(),
        orgId: new Types.ObjectId().toString(),
      },
    }
    const response = { statusCode: 201 }
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    }
    const next = {
      handle: () => of('ok'),
    }

    await lastValueFrom(interceptor.intercept(context as any, next as any))

    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'member.invite',
      resource: 'member',
      target: '13800138000',
      meta: expect.objectContaining({
        phone: '13800138000',
        role: 'editor',
      }),
    }))
  })
})
