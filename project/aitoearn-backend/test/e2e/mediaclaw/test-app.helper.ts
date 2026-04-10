import { INestApplication } from '@nestjs/common'
import { ZodValidationPipe } from '@yikart/common'
import { Test } from '@nestjs/testing'
import { UserRole } from '@yikart/mongodb'
import request from 'supertest'
import { vi } from 'vitest'

export const testAccessToken = 'test-access-token'
export const testUser = {
  id: '507f1f77bcf86cd799439012',
  orgId: '507f1f77bcf86cd799439011',
  role: UserRole.ENTERPRISE_ADMIN,
  apiKeyId: 'mc_live_test_key',
}

export function createResponseMock(name: string) {
  return vi.fn(async (...args: any[]) => ({
    handler: name,
    args,
  }))
}

interface CreateMediaClawTestAppOptions {
  controllers: any[]
  providers: any[]
  authToken?: string
  user?: Record<string, unknown>
}

export async function createMediaClawTestApp(options: CreateMediaClawTestAppOptions) {
  const authToken = options.authToken || testAccessToken
  const user = {
    ...testUser,
    ...(options.user || {}),
  }

  const moduleRef = await Test.createTestingModule({
    controllers: options.controllers,
    providers: options.providers,
  }).compile()

  const app = moduleRef.createNestApplication()
  app.useGlobalPipes(new ZodValidationPipe())
  app.use((req: any, _res: any, next: () => void) => {
    req.user = { ...user }
    next()
  })
  await app.init()

  return {
    app: app as INestApplication,
    client: request(app.getHttpServer()),
    authToken,
    user,
  }
}
