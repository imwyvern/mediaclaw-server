import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants'
import { OrgApiKeyProvider } from '@yikart/mongodb'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaClawApiKeyController } from '../../../apps/aitoearn-server/src/core/mediaclaw/apikey/apikey.controller'
import { MediaClawApiKeyService } from '../../../apps/aitoearn-server/src/core/mediaclaw/apikey/apikey.service'
import { CopyController } from '../../../apps/aitoearn-server/src/core/mediaclaw/copy/copy.controller'
import { CopyService } from '../../../apps/aitoearn-server/src/core/mediaclaw/copy/copy.service'
import { StyleRewriteService } from '../../../apps/aitoearn-server/src/core/mediaclaw/copy/style-rewrite.service'
import { OrgController } from '../../../apps/aitoearn-server/src/core/mediaclaw/org/org.controller'
import { OrgService } from '../../../apps/aitoearn-server/src/core/mediaclaw/org/org.service'
import { PipelineController } from '../../../apps/aitoearn-server/src/core/mediaclaw/pipeline/pipeline.controller'
import { PipelineService } from '../../../apps/aitoearn-server/src/core/mediaclaw/pipeline/pipeline.service'
import {
  createMediaClawTestApp,
  testAccessToken,
  testUser,
} from './test-app.helper'

Reflect.defineMetadata('design:paramtypes', [MediaClawApiKeyService], MediaClawApiKeyController)
Reflect.defineMetadata('design:paramtypes', [OrgService], OrgController)
Reflect.defineMetadata('design:paramtypes', [PipelineService], PipelineController)
Reflect.defineMetadata('design:paramtypes', [CopyService, StyleRewriteService], CopyController)

Reflect.defineMetadata(GUARDS_METADATA, [], MediaClawApiKeyController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], MediaClawApiKeyController)
Reflect.defineMetadata(GUARDS_METADATA, [], OrgController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], OrgController)
Reflect.defineMetadata(GUARDS_METADATA, [], PipelineController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], PipelineController)
Reflect.defineMetadata(GUARDS_METADATA, [], CopyController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], CopyController)

describe('MediaClaw Sprint 2-4 Control Plane E2E', () => {
  let app: Awaited<ReturnType<typeof createMediaClawTestApp>>['app']
  let client: Awaited<ReturnType<typeof createMediaClawTestApp>>['client']

  const apiKeyService = {
    createByok: vi.fn(),
    deleteByok: vi.fn(),
    listByok: vi.fn(),
    rotateByok: vi.fn(),
    validateIncomingByok: vi.fn(),
    validateStoredByok: vi.fn(),
  }

  const orgService = {
    getModelPreferences: vi.fn(),
    updateModelPreferences: vi.fn(),
  }

  const pipelineService = {
    getPreferenceProfile: vi.fn(),
    updatePreferences: vi.fn(),
  }

  const copyService = {
    generateForHttp: vi.fn(),
    listHistory: vi.fn(),
  }

  const styleRewriteService = {
    rewriteForPlatform: vi.fn(),
  }

  beforeAll(async () => {
    const testApp = await createMediaClawTestApp({
      controllers: [
        MediaClawApiKeyController,
        OrgController,
        PipelineController,
        CopyController,
      ],
      providers: [
        { provide: MediaClawApiKeyService, useValue: apiKeyService },
        { provide: OrgService, useValue: orgService },
        { provide: PipelineService, useValue: pipelineService },
        { provide: CopyService, useValue: copyService },
        { provide: StyleRewriteService, useValue: styleRewriteService },
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

    apiKeyService.createByok.mockResolvedValue({
      provider: OrgApiKeyProvider.GEMINI,
      status: 'active',
    })
    apiKeyService.listByok.mockResolvedValue([
      { provider: OrgApiKeyProvider.GEMINI, status: 'active' },
    ])
    apiKeyService.validateIncomingByok.mockResolvedValue({
      provider: OrgApiKeyProvider.GEMINI,
      valid: true,
    })
    apiKeyService.validateStoredByok.mockResolvedValue({
      provider: OrgApiKeyProvider.GEMINI,
      valid: true,
    })
    apiKeyService.rotateByok.mockResolvedValue({
      provider: OrgApiKeyProvider.GEMINI,
      rotated: true,
    })
    apiKeyService.deleteByok.mockResolvedValue({
      provider: OrgApiKeyProvider.GEMINI,
      removed: true,
    })

    orgService.getModelPreferences.mockResolvedValue({
      chat: 'gemini-2.5-pro',
      copy: 'deepseek-v3',
      frameEdit: 'gpt-image-1',
      videoGen: 'kling-2.0',
      analysis: 'gpt-4.1',
    })
    orgService.updateModelPreferences.mockResolvedValue({
      updated: true,
    })

    pipelineService.getPreferenceProfile.mockResolvedValue({
      pipelineId: '507f1f77bcf86cd799439020',
      preferredStyles: ['真人口播'],
    })
    pipelineService.updatePreferences.mockResolvedValue({
      updated: true,
    })

    copyService.generateForHttp.mockResolvedValue({
      items: [{ id: 'copy-1', title: '爆款开头' }],
    })
    copyService.listHistory.mockResolvedValue({
      items: [{ id: 'history-1' }],
      total: 1,
    })
  })

  it('应覆盖 BYOK 控制器核心入口', async () => {
    const byokBody = {
      provider: OrgApiKeyProvider.GEMINI,
      apiKey: 'gemini-secret-key',
      validateNow: true,
    }

    const createResponse = await client
      .post('/api/v1/apikey/byok')
      .set('authorization', `Bearer ${testAccessToken}`)
      .send(byokBody)

    expect(createResponse.status).toBe(201)
    expect(apiKeyService.createByok).toHaveBeenCalledWith(testUser.orgId, byokBody)

    const listResponse = await client
      .get('/api/v1/apikey/byok')
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(listResponse.status).toBe(200)
    expect(apiKeyService.listByok).toHaveBeenCalledWith(testUser.orgId)

    const validateIncomingResponse = await client
      .post('/api/v1/apikey/byok/validate')
      .send(byokBody)

    expect(validateIncomingResponse.status).toBe(201)
    expect(apiKeyService.validateIncomingByok).toHaveBeenCalledWith(byokBody)

    const validateStoredResponse = await client
      .post(`/api/v1/apikey/byok/${OrgApiKeyProvider.GEMINI}/validate`)
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(validateStoredResponse.status).toBe(201)
    expect(apiKeyService.validateStoredByok).toHaveBeenCalledWith(
      testUser.orgId,
      OrgApiKeyProvider.GEMINI,
    )

    const rotateBody = {
      apiKey: 'gemini-rotated-key',
      validateNow: false,
    }

    const rotateResponse = await client
      .post(`/api/v1/apikey/byok/${OrgApiKeyProvider.GEMINI}/rotate`)
      .set('authorization', `Bearer ${testAccessToken}`)
      .send(rotateBody)

    expect(rotateResponse.status).toBe(201)
    expect(apiKeyService.rotateByok).toHaveBeenCalledWith(
      testUser.orgId,
      OrgApiKeyProvider.GEMINI,
      rotateBody,
    )

    const deleteResponse = await client
      .delete(`/api/v1/apikey/byok/${OrgApiKeyProvider.GEMINI}`)
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(deleteResponse.status).toBe(200)
    expect(apiKeyService.deleteByok).toHaveBeenCalledWith(
      testUser.orgId,
      OrgApiKeyProvider.GEMINI,
    )
  })

  it('应覆盖组织模型偏好控制器入口', async () => {
    const getResponse = await client
      .get('/api/v1/org/model-preferences')
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(getResponse.status).toBe(200)
    expect(orgService.getModelPreferences).toHaveBeenCalledWith(testUser.orgId)

    const updateBody = {
      chat: 'gemini-2.5-pro',
      copy: 'deepseek-v3',
      frameEdit: 'gpt-image-1',
      videoGen: 'kling-2.0',
      analysis: 'gpt-4.1',
    }

    const updateResponse = await client
      .patch('/api/v1/org/model-preferences')
      .set('authorization', `Bearer ${testAccessToken}`)
      .send(updateBody)

    expect(updateResponse.status).toBe(200)
    expect(orgService.updateModelPreferences).toHaveBeenCalledWith(
      testUser.orgId,
      updateBody,
    )
  })

  it('应覆盖 pipeline 偏好画像控制器入口', async () => {
    const pipelineId = '507f1f77bcf86cd799439020'

    const getResponse = await client
      .get(`/api/v1/pipelines/${pipelineId}/preferences`)
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(getResponse.status).toBe(200)
    expect(pipelineService.getPreferenceProfile).toHaveBeenCalledWith(
      testUser.orgId,
      pipelineId,
    )

    const updateBody = {
      preferredStyles: ['真人口播'],
      avoidStyles: ['过度炫技'],
      preferredDuration: 25,
      aspectRatio: '9:16',
      remixInsights: {
        hook: '前三秒对比',
      },
    }

    const updateResponse = await client
      .patch(`/api/v1/pipelines/${pipelineId}/preferences`)
      .set('authorization', `Bearer ${testAccessToken}`)
      .send(updateBody)

    expect(updateResponse.status).toBe(200)
    expect(pipelineService.updatePreferences).toHaveBeenCalledWith(
      testUser.orgId,
      pipelineId,
      updateBody,
    )
  })

  it('应覆盖 copy-v2 生成与历史入口', async () => {
    const generateBody = {
      brandId: '507f1f77bcf86cd799439021',
      theme: '春季上新',
      platform: 'douyin',
      style: '反差钩子',
      provider: 'gemini',
      sourceHint: '新品唇釉',
      videoUrl: 'https://example.com/video.mp4',
      count: 2,
    }

    const generateResponse = await client
      .post('/api/v1/copy/generate')
      .set('authorization', `Bearer ${testAccessToken}`)
      .send(generateBody)

    expect(generateResponse.status).toBe(201)
    expect(copyService.generateForHttp).toHaveBeenCalledWith(
      testUser.orgId,
      testUser.id,
      generateBody,
    )

    const historyResponse = await client
      .get('/api/v1/copy/history')
      .query({
        videoTaskId: '507f1f77bcf86cd799439022',
      })
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(historyResponse.status).toBe(200)
    expect(copyService.listHistory).toHaveBeenCalledWith(
      testUser.orgId,
      expect.objectContaining({
        videoTaskId: '507f1f77bcf86cd799439022',
      }),
    )
  })
})
