import { describe, expect, it } from 'vitest'
import { DedupService } from './dedup.service'

describe('DedupService', () => {
  it('should create deterministic dedup strategies for the same seed', () => {
    const service = new DedupService()

    const left = service.createStrategy('task-1', 'seed-a', ['#FF0000'], false)
    const right = service.createStrategy('task-1', 'seed-a', ['#FF0000'], false)

    expect(left).toEqual(right)
    expect(left.cropScale).toBeGreaterThan(1)
    expect(left.speedFactor).not.toBe(0)
  })

  it('should pin speed factor when source audio must be preserved', () => {
    const service = new DedupService()
    const strategy = service.createStrategy('task-2', 'seed-b', [], true)

    expect(strategy.speedFactor).toBe(1)
  })
})
