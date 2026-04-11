import { createHash } from 'node:crypto'
import { Injectable, NotFoundException } from '@nestjs/common'
import {
  ProductAgentDefinition,
  ProductAgentResolvedVersion,
} from '../agent-product.types'
import { AgentRegistryService } from './agent-registry.service'

@Injectable()
export class AgentVersioningService {
  constructor(
    private readonly agentRegistryService: AgentRegistryService,
  ) {}

  async resolveVersion(
    agentId: string,
    userId: string,
    targetVersion?: string,
  ): Promise<ProductAgentResolvedVersion> {
    if (targetVersion) {
      const definition = await this.agentRegistryService.getAgentVersion(agentId, targetVersion)
      if (!definition) {
        throw new NotFoundException(`Agent version not found: ${agentId}@${targetVersion}`)
      }

      return {
        definition,
        selectedVersion: definition.version,
        bucket: this.buildBucket(agentId, userId),
        variantLabel: 'pinned',
      }
    }

    const versions = await this.agentRegistryService.listAgentVersions(agentId)
    if (versions.length === 0) {
      throw new NotFoundException(`Agent not found: ${agentId}`)
    }

    const defaultDefinition = versions.find(version => version.isDefault) || versions[0]!
    const bucket = this.buildBucket(agentId, userId)

    switch (defaultDefinition.rolloutStrategy) {
      case 'canary':
      case 'ab_test': {
        const selected = this.resolveWeightedVersion(defaultDefinition, versions, bucket)
        return {
          definition: selected.definition,
          selectedVersion: selected.definition.version,
          bucket,
          variantLabel: selected.label,
        }
      }

      default:
        return {
          definition: defaultDefinition,
          selectedVersion: defaultDefinition.version,
          bucket,
          variantLabel: 'stable',
        }
    }
  }

  private resolveWeightedVersion(
    defaultDefinition: ProductAgentDefinition,
    versions: ProductAgentDefinition[],
    bucket: number,
  ) {
    const targets = defaultDefinition.rolloutTargets.length > 0
      ? defaultDefinition.rolloutTargets
      : [{ version: defaultDefinition.version, weight: 100, label: defaultDefinition.rolloutStrategy }]

    let offset = 0
    for (const target of targets) {
      offset += target.weight
      if (bucket < offset) {
        const matched = versions.find(version => version.version === target.version)
        if (matched) {
          return {
            definition: matched,
            label: target.label || defaultDefinition.rolloutStrategy,
          }
        }
      }
    }

    return {
      definition: defaultDefinition,
      label: defaultDefinition.rolloutStrategy,
    }
  }

  private buildBucket(agentId: string, userId: string) {
    const hash = createHash('sha256')
      .update(`${agentId}:${userId}`)
      .digest('hex')
      .slice(0, 8)

    return Number.parseInt(hash, 16) % 100
  }
}
