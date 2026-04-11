import { describe, expect, it, vi } from 'vitest'
import { AgentProductService } from './agent-product.service'

describe('agentProductService behavior', () => {
  it('应按当前用户与组织范围查询 Agent 调用日志', async () => {
    const agentRegistryService = {} as never
    const agentVersioningService = {} as never
    const agentRuntimeService = {} as never
    const agentProductOrchestratorService = {} as never
    const agentObservabilityService = {
      listLogs: vi.fn().mockResolvedValue([[], 0]),
    } as never

    const service = new AgentProductService(
      agentRegistryService,
      agentVersioningService,
      agentRuntimeService,
      agentProductOrchestratorService,
      agentObservabilityService,
    )

    await service.getAgentLogs('copy-generator', {
      userId: 'user-1',
      orgId: 'org-1',
      page: 2,
      pageSize: 20,
      status: 'success',
    })

    expect(agentObservabilityService.listLogs).toHaveBeenCalledWith(
      'copy-generator',
      {
        userId: 'user-1',
        orgId: 'org-1',
        page: 2,
        pageSize: 20,
        status: 'success',
      },
    )
  })
})
