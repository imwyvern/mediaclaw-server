import { Injectable, Logger } from '@nestjs/common'
import {
  runProductShowcasePipeline,
  runAiLivePipeline,
  runExplainerPipeline,
} from '@yikart/mediaclaw-agent-runtime'
import {
  videoDownload,
  sceneCutter,
  motionAnalyzer,
} from '@yikart/mediaclaw-tools-ingest'
import { brandReplacer } from '@yikart/mediaclaw-tools-branding'
import { videoGenerator } from '@yikart/mediaclaw-tools-generation'
import { scriptWriter, ttsEngine } from '@yikart/mediaclaw-tools-audio-text'
import { videoAssembler, finalComposer } from '@yikart/mediaclaw-tools-compose'
import {
  qaOptimizer,
  dedupGatekeeper,
  contentReviewer,
} from '@yikart/mediaclaw-tools-quality'
import {
  trendingScout,
  contentPlanner,
  remixBrief,
  performanceInsight,
} from '@yikart/mediaclaw-tools-intelligence'
import { platformPackager } from '@yikart/mediaclaw-tools-platform'

@Injectable()
export class MediaclawService {
  private readonly logger = new Logger(MediaclawService.name)

  async runProductShowcase(input: any) {
    this.logger.log('Starting ProductShowcase pipeline')

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const toolbox: any = {
      videoDownload,
      sceneCutter,
      motionAnalyzer,
      brandReplacer,
      videoGenerator,
      scriptWriter,
      ttsEngine,
      videoAssembler,
      finalComposer,
      qaOptimizer,
      dedupGatekeeper,
      contentReviewer,
    }

    return await runProductShowcasePipeline(input, toolbox, (event) => {
      this.logger.debug(`[${event.step}] ${event.toolId}: ${event.status} (${event.durationMs}ms)`)
    })
  }

  async runAiLive(input: any) {
    this.logger.log('Starting AiLive pipeline')
    const toolbox: any = { videoGenerator, videoAssembler, finalComposer, qaOptimizer }
    return await runAiLivePipeline(input, toolbox)
  }

  async runExplainer(input: any) {
    this.logger.log('Starting Explainer pipeline')
    const toolbox: any = {
      remotionRender: async () => { throw new Error('Remotion not configured') },
      scriptWriter,
      ttsEngine,
      finalComposer,
      qaOptimizer,
    }
    return await runExplainerPipeline(input, toolbox)
  }

  async createRemixBrief(input: any) {
    return await remixBrief(input)
  }

  async scoutTrending(input: any) {
    return await trendingScout(input)
  }

  async planContent(input: any) {
    return await contentPlanner(input)
  }

  async packageForPlatform(input: any) {
    const video = {
      assetId: input.videoAssetId,
      storageKey: `/tmp/${input.videoAssetId}.mp4`,
      sha256: 'placeholder',
      mimeType: 'video/mp4' as const,
      durationSec: 15,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: true,
    }
    return await platformPackager({ ...input, video })
  }

  async getInsight(videoId: string, platform: string) {
    return await performanceInsight({ mode: 'realtime', videoId, platform: platform as any })
  }

  async getMonthlyInsight(orgId: string, period: string) {
    return await performanceInsight({ mode: 'monthly', orgId, period })
  }
}
