import { Buffer } from 'node:buffer'
import { vi } from 'vitest'

const execaMock = vi.hoisted(() => vi.fn())
const readFileSyncMock = vi.hoisted(() => vi.fn())
const existsSyncMock = vi.hoisted(() => vi.fn())
const unlinkSyncMock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({
  default: execaMock,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {
    ...actual,
    readFileSync: readFileSyncMock,
    existsSync: existsSyncMock,
    unlinkSync: unlinkSyncMock,
  }
})

vi.mock('@yikart/assets', () => ({
  AssetsService: class {},
  VideoMetadataService: class {},
}))

vi.mock('../../ai/chat', () => ({
  ChatService: class {},
}))

vi.mock('../../ai/libs/gemini', () => ({
  GeminiService: class {},
}))

vi.mock('../../ai/libs/volcengine', () => ({
  VolcengineService: class {},
}))

vi.mock('@yikart/mongodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yikart/mongodb')>().catch(() => ({} as typeof import('@yikart/mongodb')))

  return {
    ...actual,
    AssetType: actual.AssetType || {
      Subtitle: 'subtitle',
      VideoThumbnail: 'videoThumbnail',
    },
  }
})

import { SubtitleMcp } from './subtitle.mcp'
import { VideoUtilsMcp } from './video-utils.mcp'
import { VideoMetadataService } from '../../../../../../libs/assets/src/video-metadata.service'

describe('execa CJS compatibility', () => {
  beforeEach(() => {
    execaMock.mockReset()
    readFileSyncMock.mockReset()
    existsSyncMock.mockReset()
    unlinkSyncMock.mockReset()
  })

  it('SubtitleMcp should call default execa export when extracting audio', async () => {
    execaMock.mockResolvedValue({ stdout: '' })
    readFileSyncMock.mockReturnValue(Buffer.from('subtitle-audio'))
    existsSyncMock.mockReturnValue(true)

    const subtitleMcp = new SubtitleMcp({} as never, {} as never)

    const buffer = await (subtitleMcp as any).extractAudioWithFFmpeg('https://example.com/video.mp4')

    expect(buffer).toEqual(Buffer.from('subtitle-audio'))
    expect(execaMock).toHaveBeenCalledWith(
      'ffmpeg',
      [
        '-i',
        'https://example.com/video.mp4',
        '-vn',
        '-acodec',
        'aac',
        '-b:a',
        '128k',
        '-y',
        expect.stringContaining('audio-'),
      ],
    )
    expect(unlinkSyncMock).toHaveBeenCalledTimes(1)
  })

  it('VideoUtilsMcp should call default execa export when extracting audio', async () => {
    execaMock.mockResolvedValue({ stdout: '' })
    readFileSyncMock.mockReturnValue(Buffer.from('video-utils-audio'))
    existsSyncMock.mockReturnValue(true)

    const videoUtilsMcp = new VideoUtilsMcp(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )

    const buffer = await (videoUtilsMcp as any).extractAudioWithFFmpeg('https://example.com/video.mp4')

    expect(buffer).toEqual(Buffer.from('video-utils-audio'))
    expect(execaMock).toHaveBeenCalledWith(
      'ffmpeg',
      [
        '-i',
        'https://example.com/video.mp4',
        '-map',
        '0:a:0',
        '-vn',
        '-acodec',
        'libmp3lame',
        '-b:a',
        '128k',
        '-y',
        expect.stringContaining('audio-'),
      ],
    )
    expect(unlinkSyncMock).toHaveBeenCalledTimes(1)
  })

  it('VideoMetadataService should request a Buffer stdout shape compatible with execa v5', async () => {
    execaMock.mockResolvedValue({ stdout: Buffer.from('thumbnail-bytes') })

    const service = new VideoMetadataService({} as never, {} as never)

    const result = await service.extractThumbnailFromUrl('https://example.com/video.mp4', 1)

    expect(result).toEqual(Buffer.from('thumbnail-bytes'))
    expect(execaMock).toHaveBeenCalledWith(
      'ffmpeg',
      [
        '-ss',
        '1',
        '-i',
        'https://example.com/video.mp4',
        '-vframes',
        '1',
        '-f',
        'image2pipe',
        '-vcodec',
        'png',
        '-',
      ],
      expect.objectContaining({
        timeout: 60000,
        encoding: null,
      }),
    )
  })
})
