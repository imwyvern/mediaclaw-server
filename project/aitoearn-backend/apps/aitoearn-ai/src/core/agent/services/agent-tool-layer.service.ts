import { Injectable } from '@nestjs/common'
import {
  AgentRoleKey,
  AgentToolSelection,
} from '../agent-orchestration.types'
import { McpServerName } from '../agent.constants'
import { AgentRoleRegistryService } from './agent-role-registry.service'

@Injectable()
export class AgentToolLayerService {
  constructor(
    private readonly agentRoleRegistryService: AgentRoleRegistryService,
  ) {}

  public selectTools(params: {
    roles: AgentRoleKey[]
    availableServers: McpServerName[]
  }): AgentToolSelection {
    const availableServerSet = new Set(params.availableServers)
    const selectedServers: McpServerName[] = []
    const roleServerMap: Partial<Record<AgentRoleKey, McpServerName[]>> = {}
    const toolFocus: string[] = []

    for (const role of params.roles) {
      const roleDefinition = this.agentRoleRegistryService.getRole(role)
      const matchedServers = roleDefinition.defaultServers.filter(server => availableServerSet.has(server))

      roleServerMap[role] = matchedServers

      for (const server of matchedServers) {
        if (!selectedServers.includes(server)) {
          selectedServers.push(server)
        }
      }

      toolFocus.push(`${roleDefinition.name}: ${matchedServers.join(', ') || McpServerName.Util}`)
    }

    if (!selectedServers.includes(McpServerName.Util) && availableServerSet.has(McpServerName.Util)) {
      selectedServers.unshift(McpServerName.Util)
    }

    return {
      selectedServers,
      roleServerMap,
      toolFocus,
    }
  }
}
