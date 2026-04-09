import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { Logger } from '@nestjs/common'
import { UserType } from '@yikart/common'
import { vi } from 'vitest'
import { AideoService } from '../../../ai/aideo'
import { AideoTaskStatus } from '../../../ai/libs/volcengine'
import { AideoMcp, AideoToolName } from './aideo.mcp'

interface ToolLike { name?: string }
type ServerToolLookup = Pick<McpSdkServerConfigWithInstance, 'instance'> & {
  tools?: ToolLike[]
  _config?: {
    tools?: ToolLike[]
  }
}

function getServerToolNames(server: ServerToolLookup) {
  if (Array.isArray(server?.tools)) {
    const names = server.tools
      .map((tool: { name?: string }) => tool.name)
      .filter((name: string | undefined): name is string => Boolean(name))
    if (names.length > 0) {
      return names
    }
  }

  if (Array.isArray(server?._config?.tools)) {
    const names = server._config.tools
      .map((tool: { name?: string }) => tool.name)
      .filter((name: string | undefined): name is string => Boolean(name))
    if (names.length > 0) {
      return names
    }
  }

  const registeredTools = server?.instance?._registeredTools
  if (registeredTools instanceof Map) {
    return Array.from(registeredTools.keys())
  }
  if (registeredTools && typeof registeredTools === 'object') {
    return Object.keys(registeredTools)
  }

  return []
}

function getServerVersion(server: ServerToolLookup & { version?: string }) {
  return server?.version ?? server?.instance?.server?._serverInfo?.version
}

describe('aideoMcp', () => {
  let aideoMcp: AideoMcp
  let mockLogger: Logger
  let mockAideoService: vi.Mocked<AideoService>

  const userId = 'test-user-id'
  const userType = UserType.User

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    } as unknown as Logger

    mockAideoService = {
      submitAideoTask: vi.fn(),
      getAideoTask: vi.fn(),
    } as unknown as vi.Mocked<AideoService>

    aideoMcp = new AideoMcp(mockAideoService)
    // Override the logger for testing
    Object.defineProperty(aideoMcp, 'logger', { value: mockLogger })
  })

  describe('createSubmitAideoTaskTool', () => {
    it('should have correct tool name', () => {
      const tool = aideoMcp.createSubmitAideoTaskTool(userId, userType)
      expect(tool.name).toBe(AideoToolName.SubmitAideoTask)
    })

    it('should call aideoService.submitAideoTask with correct params', async () => {
      mockAideoService.submitAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
      })

      const tool = aideoMcp.createSubmitAideoTaskTool(userId, userType)
      await tool.handler({
        prompt: 'Translate this video to English',
        multiInputs: ['https://example.com/video.mp4'],
      }, {})

      expect(mockAideoService.submitAideoTask).toHaveBeenCalledWith({
        userId,
        userType,
        prompt: 'Translate this video to English',
        multiInputs: ['https://example.com/video.mp4'],
      })
    })

    it('should return success result with task id', async () => {
      mockAideoService.submitAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
      })

      const tool = aideoMcp.createSubmitAideoTaskTool(userId, userType)
      const result = await tool.handler({
        prompt: 'Translate this video to English',
        multiInputs: ['https://example.com/video.mp4'],
      }, {})

      expect(result.isError).toBeUndefined()
      const textContent = result.content[0] as { type: 'text', text: string }
      expect(textContent.text).toContain('aideo-task-123')
      expect(textContent.text).toContain('submitted successfully')
    })

    it('should handle multiple inputs', async () => {
      mockAideoService.submitAideoTask.mockResolvedValue({
        taskId: 'aideo-task-456',
      })

      const tool = aideoMcp.createSubmitAideoTaskTool(userId, userType)
      await tool.handler({
        prompt: 'Merge these videos',
        multiInputs: [
          'https://example.com/video1.mp4',
          'https://example.com/video2.mp4',
          'https://example.com/video3.mp4',
        ],
      }, {})

      expect(mockAideoService.submitAideoTask).toHaveBeenCalledWith({
        userId,
        userType,
        prompt: 'Merge these videos',
        multiInputs: [
          'https://example.com/video1.mp4',
          'https://example.com/video2.mp4',
          'https://example.com/video3.mp4',
        ],
      })
    })
  })

  describe('createGetAideoTaskStatusTool', () => {
    it('should have correct tool name', () => {
      const tool = aideoMcp.createGetAideoTaskStatusTool(userId, userType)
      expect(tool.name).toBe(AideoToolName.GetAideoTaskStatus)
    })

    it('should return error when task fails', async () => {
      mockAideoService.getAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
        model: 'aideo',
        status: AideoTaskStatus.Failed,
        errorMessage: 'Video processing failed',
        apiResponses: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)

      const tool = aideoMcp.createGetAideoTaskStatusTool(userId, userType)
      const result = await tool.handler({ taskId: 'aideo-task-123' }, {})

      expect(result.isError).toBe(true)
      const textContent = result.content[0] as { type: 'text', text: string }
      expect(textContent.text).toContain('failed')
      expect(textContent.text).toContain('Video processing failed')
    })

    it('should return translation output URL when completed', async () => {
      mockAideoService.getAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
        model: 'aideo',
        status: AideoTaskStatus.Completed,
        createdAt: new Date(),
        updatedAt: new Date(),
        apiResponses: [
          {
            AITranslation: {
              ProjectInfo: {
                OutputVideo: {
                  Url: 'https://example.com/translated.mp4',
                  Vid: 'vid-123',
                },
              },
            },
          },
        ],
      } as never)

      const tool = aideoMcp.createGetAideoTaskStatusTool(userId, userType)
      const result = await tool.handler({ taskId: 'aideo-task-123' }, {})

      expect(result.isError).toBeUndefined()
      const textContent = result.content[0] as { type: 'text', text: string }
      expect(textContent.text).toContain('completed successfully')
      expect(textContent.text).toContain('https://example.com/translated.mp4')
      expect(textContent.text).toContain('vid-123')
    })

    it('should return erase output URL when completed', async () => {
      mockAideoService.getAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
        model: 'aideo',
        status: AideoTaskStatus.Completed,
        createdAt: new Date(),
        updatedAt: new Date(),
        apiResponses: [
          {
            Erase: {
              Output: {
                Task: {
                  Erase: {
                    File: {
                      url: 'https://example.com/erased.mp4',
                    },
                  },
                },
              },
            },
          },
        ],
      } as never)

      const tool = aideoMcp.createGetAideoTaskStatusTool(userId, userType)
      const result = await tool.handler({ taskId: 'aideo-task-123' }, {})

      expect(result.isError).toBeUndefined()
      const textContent = result.content[0] as { type: 'text', text: string }
      expect(textContent.text).toContain('completed successfully')
      expect(textContent.text).toContain('https://example.com/erased.mp4')
    })

    it('should return highlight clips when completed', async () => {
      mockAideoService.getAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
        model: 'aideo',
        status: AideoTaskStatus.Completed,
        createdAt: new Date(),
        updatedAt: new Date(),
        apiResponses: [
          {
            Highlight: {
              Edits: [
                { url: 'https://example.com/clip1.mp4' },
                { url: 'https://example.com/clip2.mp4' },
                { url: 'https://example.com/clip3.mp4' },
              ],
            },
          },
        ],
      } as never)

      const tool = aideoMcp.createGetAideoTaskStatusTool(userId, userType)
      const result = await tool.handler({ taskId: 'aideo-task-123' }, {})

      expect(result.isError).toBeUndefined()
      const textContent = result.content[0] as { type: 'text', text: string }
      expect(textContent.text).toContain('completed successfully')
      expect(textContent.text).toContain('Highlight Clips')
      expect(textContent.text).toContain('https://example.com/clip1.mp4')
      expect(textContent.text).toContain('https://example.com/clip2.mp4')
      expect(textContent.text).toContain('https://example.com/clip3.mp4')
    })

    it('should return VCreative output URL when completed', async () => {
      mockAideoService.getAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
        model: 'aideo',
        status: AideoTaskStatus.Completed,
        createdAt: new Date(),
        updatedAt: new Date(),
        apiResponses: [
          {
            VCreative: {
              OutputJson: { Result: { url: 'https://example.com/creative.mp4' } },
            },
          },
        ],
      } as never)

      const tool = aideoMcp.createGetAideoTaskStatusTool(userId, userType)
      const result = await tool.handler({ taskId: 'aideo-task-123' }, {})

      expect(result.isError).toBeUndefined()
      const textContent = result.content[0] as { type: 'text', text: string }
      expect(textContent.text).toContain('completed successfully')
      expect(textContent.text).toContain('https://example.com/creative.mp4')
    })

    it('should return Vision analysis results when completed', async () => {
      mockAideoService.getAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
        model: 'aideo',
        status: AideoTaskStatus.Completed,
        createdAt: new Date(),
        updatedAt: new Date(),
        apiResponses: [
          {
            Vision: {
              Content: 'This video shows a cat playing with a ball. Keywords: cat, play, ball.',
            },
          },
        ],
      } as never)

      const tool = aideoMcp.createGetAideoTaskStatusTool(userId, userType)
      const result = await tool.handler({ taskId: 'aideo-task-123' }, {})

      expect(result.isError).toBeUndefined()
      const textContent = result.content[0] as { type: 'text', text: string }
      expect(textContent.text).toContain('completed successfully')
      expect(textContent.text).toContain('Vision Analysis Results')
      expect(textContent.text).toContain('cat playing with a ball')
    })

    it('should return processing status when task is still running', async () => {
      mockAideoService.getAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
        model: 'aideo',
        status: AideoTaskStatus.Processing,
        createdAt: new Date(),
        updatedAt: new Date(),
        apiResponses: [],
      } as never)

      const tool = aideoMcp.createGetAideoTaskStatusTool(userId, userType)
      const result = await tool.handler({ taskId: 'aideo-task-123' }, {})

      expect(result.isError).toBeUndefined()
      const textContent = result.content[0] as { type: 'text', text: string }
      expect(textContent.text).toContain(AideoTaskStatus.Processing)
      expect(textContent.text).toContain('continue polling')
    })

    it('should handle unknown error message', async () => {
      mockAideoService.getAideoTask.mockResolvedValue({
        taskId: 'aideo-task-123',
        model: 'aideo',
        status: AideoTaskStatus.Failed,
        createdAt: new Date(),
        updatedAt: new Date(),
        apiResponses: [],
      } as never)

      const tool = aideoMcp.createGetAideoTaskStatusTool(userId, userType)
      const result = await tool.handler({ taskId: 'aideo-task-123' }, {})

      expect(result.isError).toBe(true)
      const textContent = result.content[0] as { type: 'text', text: string }
      expect(textContent.text).toContain('Unknown error')
    })
  })

  describe('createServer', () => {
    it('should create server with correct name', () => {
      const server = aideoMcp.createServer(userId, userType)
      expect(server.name).toBe('aideo')
    })

    it('should include expected tools', () => {
      const server = aideoMcp.createServer(userId, userType)
      const toolNames = getServerToolNames(server)

      expect(toolNames).toContain(AideoToolName.SubmitAideoTask)
      expect(toolNames).toContain(AideoToolName.GetAideoTaskStatus)
    })

    it('should have version 1.0.0', () => {
      const server = aideoMcp.createServer(userId, userType)
      expect(getServerVersion(server)).toBe('1.0.0')
    })
  })
})
