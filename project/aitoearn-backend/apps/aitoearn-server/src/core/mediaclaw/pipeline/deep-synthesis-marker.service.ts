import { Injectable } from '@nestjs/common'
import {
  PipelineBrandProfile,
  PipelineDeepSynthesisManifest,
  PipelineDeepSynthesisMarker,
} from './pipeline.types'

@Injectable()
export class DeepSynthesisMarkerService {
  private readonly defaultLabel = process.env['MEDIACLAW_AI_WATERMARK_TEXT']?.trim() || 'AI深度合成'
  private readonly complianceStandard = 'PRD-5.1.1'

  createMarker(taskId: string, brand: PipelineBrandProfile): PipelineDeepSynthesisMarker {
    const brandName = brand.name?.trim() || 'MediaClaw'
    const visibleLabel = this.defaultLabel
    const watermarkText = brandName
    const metadata = {
      title: `${brandName} AI Video`,
      artist: 'MediaClaw',
      comment: `${visibleLabel}; compliance=${this.complianceStandard}; task=${taskId}; brand=${brandName}`,
      description: `MediaClaw generated content with required AI deep synthesis watermark for ${brandName}`,
      copyright: `MediaClaw ${brandName}`,
    }
    const manifest: PipelineDeepSynthesisManifest = {
      standard: this.complianceStandard,
      label: visibleLabel,
      watermarkText,
      brandName,
      taskId,
      appliedAt: new Date().toISOString(),
      metadata,
    }

    return {
      visibleLabel,
      watermarkText,
      metadata,
      manifest,
    }
  }

  buildMetadataArgs(marker: PipelineDeepSynthesisMarker) {
    const args = ['-movflags', 'use_metadata_tags']

    for (const [key, value] of Object.entries(marker.metadata)) {
      args.push('-metadata', `${key}=${value}`)
    }

    return args
  }
}
