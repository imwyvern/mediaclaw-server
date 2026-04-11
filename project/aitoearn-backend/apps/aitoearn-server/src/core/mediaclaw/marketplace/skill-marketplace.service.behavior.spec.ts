import { SkillMarketplaceEntryStatus, SkillMarketplaceVisibility } from '@yikart/mongodb'
import { describe, expect, it, vi } from 'vitest'
import { SkillMarketplaceService } from './skill-marketplace.service'

vi.mock('@yikart/mongodb', () => ({
  LayerBillingModel: {
    QUOTA: 'quota',
  },
  SkillMarketplaceEntry: class SkillMarketplaceEntry {},
  SkillMarketplaceEntryRepository: class SkillMarketplaceEntryRepository {},
  SkillMarketplaceEntryStatus: {
    DRAFT: 'draft',
    PUBLISHED: 'published',
    ARCHIVED: 'archived',
  },
  SkillMarketplaceVisibility: {
    PUBLIC: 'public',
    PRIVATE: 'private',
    ORGANIZATION: 'organization',
  },
}))

describe('skillMarketplaceService behavior', () => {
  it('应对 marketplace 搜索关键字做正则转义', async () => {
    const skillMarketplaceEntryRepository = {
      listByQuery: vi.fn().mockResolvedValue([[], 0]),
    }
    const service = new SkillMarketplaceService(
      skillMarketplaceEntryRepository as any,
      {} as any,
    )

    await service.listSkills(
      '661e7e4c77f6a93b0cf6271e',
      {
        search: 'agent+(test).*',
      },
      undefined,
      { page: 1, limit: 20 },
    )

    const query = skillMarketplaceEntryRepository.listByQuery.mock.calls[0][0]
    const searchCondition = query.$and[0]
    const patterns = searchCondition.$or.map(
      (item: Record<string, RegExp>) => Object.values(item)[0],
    )

    expect(patterns).toHaveLength(4)
    patterns.forEach((pattern: RegExp) => {
      expect(pattern).toBeInstanceOf(RegExp)
      expect(pattern.source).toBe('agent\\+\\(test\\)\\.\\*')
      expect(pattern.flags).toContain('i')
    })
    expect(query.$and[1]).toEqual({
      $or: [
        {
          status: SkillMarketplaceEntryStatus.PUBLISHED,
          visibility: SkillMarketplaceVisibility.PUBLIC,
        },
        {
          ownerOrgId: expect.anything(),
        },
      ],
    })
  })
})
