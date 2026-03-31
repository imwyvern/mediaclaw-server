import { describe, expect, it } from 'vitest'
import { DeepSynthesisMarkerService } from './deep-synthesis-marker.service'

describe('DeepSynthesisMarkerService', () => {
  it('should create a PRD-compliant visible watermark and metadata manifest', () => {
    const service = new DeepSynthesisMarkerService()
    const marker = service.createMarker('task-123', {
      id: 'brand-1',
      name: 'MediaClaw 品牌',
      colors: [],
      fonts: [],
      slogans: [],
      keywords: [],
      prohibitedWords: [],
      preferredDuration: 15,
      aspectRatio: '9:16',
      subtitleStyle: {},
      referenceVideoUrl: '',
    })

    expect(marker.visibleLabel).toBe('AI深度合成')
    expect(marker.watermarkText).toBe('MediaClaw 品牌')
    expect(marker.manifest.standard).toBe('PRD-5.1.1')
    expect(marker.manifest.taskId).toBe('task-123')
    expect(marker.metadata.comment).toContain('AI深度合成')
    expect(marker.metadata.comment).toContain('task-123')
  })

  it('should build ffmpeg metadata args for runtime rendering', () => {
    const service = new DeepSynthesisMarkerService()
    const marker = service.createMarker('task-456', {
      id: 'brand-1',
      name: 'MediaClaw',
      colors: [],
      fonts: [],
      slogans: [],
      keywords: [],
      prohibitedWords: [],
      preferredDuration: 15,
      aspectRatio: '9:16',
      subtitleStyle: {},
      referenceVideoUrl: '',
    })

    expect(service.buildMetadataArgs(marker)).toEqual([
      '-movflags',
      'use_metadata_tags',
      '-metadata',
      expect.stringContaining('title=MediaClaw AI Video'),
      '-metadata',
      'artist=MediaClaw',
      '-metadata',
      expect.stringContaining('comment=AI深度合成'),
      '-metadata',
      expect.stringContaining('description=MediaClaw generated content'),
      '-metadata',
      'copyright=MediaClaw MediaClaw',
    ])
  })
})
