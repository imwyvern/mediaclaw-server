import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants'
import { VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentMgmtController } from '../../../apps/aitoearn-server/src/core/mediaclaw/content-mgmt/content-mgmt.controller'
import { ContentMgmtService } from '../../../apps/aitoearn-server/src/core/mediaclaw/content-mgmt/content-mgmt.service'
import { VideoController } from '../../../apps/aitoearn-server/src/core/mediaclaw/video/video.controller'
import { VideoService } from '../../../apps/aitoearn-server/src/core/mediaclaw/video/video.service'
import {
  createMediaClawTestApp,
  testAccessToken,
  testUser,
} from './test-app.helper'

Reflect.defineMetadata('design:paramtypes', [VideoService], VideoController)
Reflect.defineMetadata('design:paramtypes', [ContentMgmtService], ContentMgmtController)
Reflect.defineMetadata(GUARDS_METADATA, [], VideoController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], VideoController)
Reflect.defineMetadata(GUARDS_METADATA, [], ContentMgmtController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], ContentMgmtController)

describe('MediaClaw Content Lifecycle E2E', () => {
  let app: Awaited<ReturnType<typeof createMediaClawTestApp>>['app']
  let client: Awaited<ReturnType<typeof createMediaClawTestApp>>['client']

  const videoService = {
    createTask: vi.fn(),
    getTask: vi.fn(),
  }

  const contentMgmtService = {
    getContent: vi.fn(),
    editCopy: vi.fn(),
    markPublished: vi.fn(),
  }

  beforeAll(async () => {
    const testApp = await createMediaClawTestApp({
      controllers: [VideoController, ContentMgmtController],
      providers: [
        { provide: VideoService, useValue: videoService },
        { provide: ContentMgmtService, useValue: contentMgmtService },
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
    videoService.createTask.mockResolvedValue({
      id: '507f1f77bcf86cd799439031',
      status: VideoTaskStatus.PENDING,
    })
    videoService.getTask.mockResolvedValue({
      id: '507f1f77bcf86cd799439031',
      status: VideoTaskStatus.COMPLETED,
      outputUrl: 'https://cdn.example.com/video.mp4',
    })
    contentMgmtService.getContent.mockResolvedValue({
      id: '507f1f77bcf86cd799439031',
      status: VideoTaskStatus.COMPLETED,
      copy: {
        title: '旧标题',
      },
    })
    contentMgmtService.editCopy.mockResolvedValue({
      id: '507f1f77bcf86cd799439031',
      copy: {
        title: '新标题',
        hashtags: ['#新品发布'],
      },
    })
    contentMgmtService.markPublished.mockResolvedValue({
      id: '507f1f77bcf86cd799439031',
      status: VideoTaskStatus.PUBLISHED,
      metadata: {
        publishInfo: {
          platform: 'xiaohongshu',
          publishUrl: 'https://www.xiaohongshu.com/explore/demo',
        },
      },
    })
  })

  it('应完成创建任务、查状态、读内容、改文案并标记发布', async () => {
    const createResponse = await client
      .post('/api/v1/videos')
      .set('authorization', `Bearer ${testAccessToken}`)
      .send({
        taskType: VideoTaskType.REMIX,
        sourceVideoUrl: 'https://example.com/source.mp4',
        brandId: '507f1f77bcf86cd799439041',
      })

    expect(createResponse.status).toBe(201)
    expect(videoService.createTask).toHaveBeenCalledWith(
      testUser.orgId,
      testUser.id,
      {
        taskType: VideoTaskType.REMIX,
        sourceVideoUrl: 'https://example.com/source.mp4',
        brandId: '507f1f77bcf86cd799439041',
      },
    )

    const taskResponse = await client
      .get('/api/v1/videos/507f1f77bcf86cd799439031')
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(taskResponse.status).toBe(200)
    expect(videoService.getTask).toHaveBeenCalledWith(
      testUser.orgId,
      '507f1f77bcf86cd799439031',
    )

    const contentResponse = await client
      .get('/api/v1/content/507f1f77bcf86cd799439031')
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(contentResponse.status).toBe(200)
    expect(contentMgmtService.getContent).toHaveBeenCalledWith(
      testUser.orgId,
      '507f1f77bcf86cd799439031',
    )

    const editResponse = await client
      .patch('/api/v1/content/507f1f77bcf86cd799439031/copy')
      .set('authorization', `Bearer ${testAccessToken}`)
      .send({
        title: '新标题',
        hashtags: ['#新品发布'],
        blueWords: ['爆款'],
        commentGuides: ['评论区告诉我你更想看哪款'],
      })

    expect(editResponse.status).toBe(200)
    expect(contentMgmtService.editCopy).toHaveBeenCalledWith(
      testUser.orgId,
      '507f1f77bcf86cd799439031',
      '新标题',
      undefined,
      ['#新品发布'],
      ['爆款'],
      ['评论区告诉我你更想看哪款'],
    )

    const publishResponse = await client
      .post('/api/v1/content/507f1f77bcf86cd799439031/publish')
      .set('authorization', `Bearer ${testAccessToken}`)
      .send({
        platform: 'xiaohongshu',
        publishUrl: 'https://www.xiaohongshu.com/explore/demo',
      })

    expect(publishResponse.status).toBe(201)
    expect(contentMgmtService.markPublished).toHaveBeenCalledWith(
      testUser.orgId,
      '507f1f77bcf86cd799439031',
      'xiaohongshu',
      'https://www.xiaohongshu.com/explore/demo',
      testUser.id,
    )
  })
})
