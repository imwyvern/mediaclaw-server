import * as crypto from 'node:crypto'
import { Injectable } from '@nestjs/common'
import {
  PipelineFrameArtifact,
  PipelineJobContext,
  PipelineStyleRewritePlan,
} from './pipeline.types'

interface PreparedFramePrompt {
  prompt: string
  promptKey: string
  plan: PipelineStyleRewritePlan | null
}

@Injectable()
export class PipelineStyleRewriteService {
  private readonly defaultMutationDomains = [
    'table surface material',
    'tableware',
    'flowers',
    'ornaments',
    'lighting direction',
    'color temperature',
    'background elements',
  ]

  private readonly tableSurfaceMaterials = [
    'brushed walnut wood',
    'travertine stone',
    'polished stainless steel',
    'warm terrazzo',
    'matte black slate',
    'textured oak veneer',
  ]

  private readonly tablewareOptions = [
    'handmade ceramic set',
    'transparent crystal glassware',
    'minimal matte cutlery',
    'retro brass utensils',
    'glossy ivory porcelain',
    'champagne-tone serving set',
  ]

  private readonly flowerOptions = [
    'white tulips with airy stems',
    'wild orange ranunculus',
    'cream hydrangea cluster',
    'dried wheat bouquet',
    'deep red rose accents',
    'green eucalyptus sprigs',
  ]

  private readonly ornamentOptions = [
    'editorial magazines',
    'amber glass candle holders',
    'small marble sculpture',
    'woven linen napkins',
    'polaroid cards',
    'vintage metal tray',
  ]

  private readonly lightingDirections = [
    'hard side light from the left',
    'soft front light from the right',
    'back light with rim highlights',
    'window light from the rear right',
    'top-down studio spotlight',
    'golden-hour side light',
  ]

  private readonly colorTemperatures = [
    'warm tungsten glow',
    'neutral daylight balance',
    'cool editorial daylight',
    'sunset amber warmth',
    'clean high-key white light',
    'moody dusk blue tone',
  ]

  private readonly backgroundElements = [
    'arched shelf with subtle props',
    'soft fabric curtain layers',
    'minimal cafe counter details',
    'blurred kitchen greenery',
    'clean studio gradient panels',
    'boutique storefront reflections',
  ]

  prepareFrame(context: PipelineJobContext, frame: PipelineFrameArtifact): PreparedFramePrompt {
    if (!context.styleRewrite.enabled) {
      return {
        prompt: this.buildBrandEditPrompt(context, frame),
        promptKey: 'edit-frames',
        plan: null,
      }
    }

    const promptKey = context.styleRewrite.scope === 'per_scene'
      ? `style-rewrite:${frame.index}`
      : 'style-rewrite:shared'
    const existingPlan = frame.styleRewritePlan || this.findExistingPlan(context, promptKey)
    const plan = existingPlan || this.createPlan(context, promptKey)

    return {
      prompt: this.buildStyleRewritePrompt(context, frame, plan),
      promptKey,
      plan,
    }
  }

  private findExistingPlan(context: PipelineJobContext, promptKey: string) {
    return context.frameArtifacts.find(item => item.styleRewritePlan?.promptKey === promptKey)?.styleRewritePlan || null
  }

  private createPlan(context: PipelineJobContext, promptKey: string): PipelineStyleRewritePlan {
    const seed = this.createSeed()
    const token = `${context.taskId}:${context.templateId || 'default'}:${promptKey}:${seed}`

    return {
      enabled: true,
      promptKey,
      seed,
      templateId: context.templateId,
      scope: context.styleRewrite.scope,
      preserveComposition: context.styleRewrite.preserveComposition,
      preserveProductPlacement: context.styleRewrite.preserveProductPlacement,
      mutationDomains: this.normalizeMutationDomains(context.styleRewrite.mutationDomains),
      tableSurfaceMaterial: this.pickVariant(token, 'table-surface', this.tableSurfaceMaterials),
      tableware: this.pickVariant(token, 'tableware', this.tablewareOptions),
      flowers: this.pickVariant(token, 'flowers', this.flowerOptions),
      ornaments: this.pickVariant(token, 'ornaments', this.ornamentOptions),
      lightingDirection: this.pickVariant(token, 'lighting-direction', this.lightingDirections),
      colorTemperature: this.pickVariant(token, 'color-temperature', this.colorTemperatures),
      backgroundElement: this.pickVariant(token, 'background', this.backgroundElements),
    }
  }

  protected createSeed() {
    return crypto.randomInt(10_000, 100_000)
  }

  private buildStyleRewritePrompt(
    context: PipelineJobContext,
    frame: PipelineFrameArtifact,
    plan: PipelineStyleRewritePlan,
  ) {
    const colors = context.brand.colors.slice(0, 3).join(', ')
    const keywords = context.brand.keywords.slice(0, 4).join(', ')
    const slogans = context.brand.slogans.slice(0, 2).join(' / ')
    const prohibited = context.brand.prohibitedWords.slice(0, 4).join(', ')
    const promptParts = [
      `Edit this image for brand ${context.brand.name}.`,
      plan.preserveComposition
        ? 'Keep the exact same composition, framing, crop, camera angle, lens perspective, and subject scale.'
        : '',
      plan.preserveProductPlacement
        ? 'Keep the exact same product placement and layout structure. Do not move the hero product or re-stage the set.'
        : '',
      `Preserve the storytelling beat of the ${frame.label} shot while changing only the visual styling.`,
      context.styleRewrite.scope === 'per_scene'
        ? 'This shot can use its own rewritten style direction within the same batch.'
        : 'Use one shared rewritten art direction for this production run.',
      ...this.describeMutations(plan),
      colors ? `Keep the scene compatible with brand colors: ${colors}.` : '',
      keywords ? `Preserve the product story around: ${keywords}.` : '',
      slogans ? `Tone hint: ${slogans}.` : '',
      prohibited ? `Avoid prohibited claims or text: ${prohibited}.` : '',
      `Seed: ${plan.seed}.`,
      'Be bold with the style change, stay photorealistic, and do not add visible text overlays or watermarks.',
    ]

    return promptParts.filter(Boolean).join(' ')
  }

  private buildBrandEditPrompt(context: PipelineJobContext, frame: PipelineFrameArtifact) {
    const colors = context.brand.colors.slice(0, 3).join(', ') || 'brand primary palette'
    const slogans = context.brand.slogans.slice(0, 2).join(' / ')
    const keywords = context.brand.keywords.slice(0, 4).join(', ')
    const prohibited = context.brand.prohibitedWords.slice(0, 4).join(', ')

    return [
      `Edit the frame for brand ${context.brand.name}.`,
      `Keep the original composition and motion clue for the ${frame.label} shot.`,
      `Use brand colors: ${colors}.`,
      slogans ? `Reflect slogans: ${slogans}.` : '',
      keywords ? `Highlight keywords: ${keywords}.` : '',
      prohibited ? `Avoid words or visual claims: ${prohibited}.` : '',
      'No mask is required in phase 1. The logo area should remain clean for post subtitle brand text.',
    ].filter(Boolean).join(' ')
  }

  private describeMutations(plan: PipelineStyleRewritePlan) {
    const mutationSet = new Set(this.normalizeMutationDomains(plan.mutationDomains))
    const lines: string[] = []

    if (mutationSet.has('table surface material')) {
      lines.push(`Change the table surface material to ${plan.tableSurfaceMaterial}.`)
    }
    if (mutationSet.has('tableware')) {
      lines.push(`Change the tableware to ${plan.tableware}.`)
    }
    if (mutationSet.has('flowers')) {
      lines.push(`Change the flowers to ${plan.flowers}.`)
    }
    if (mutationSet.has('ornaments')) {
      lines.push(`Change the ornaments to ${plan.ornaments}.`)
    }
    if (mutationSet.has('lighting direction')) {
      lines.push(`Change the lighting direction to ${plan.lightingDirection}.`)
    }
    if (mutationSet.has('color temperature')) {
      lines.push(`Change the color temperature to ${plan.colorTemperature}.`)
    }
    if (mutationSet.has('background elements')) {
      lines.push(`Change the background elements to ${plan.backgroundElement}.`)
    }

    return lines
  }

  private normalizeMutationDomains(value: unknown) {
    const domains = Array.isArray(value) ? value : []
    const normalized = [...new Set(
      domains
        .map(item => typeof item === 'string' ? item.trim().toLowerCase() : '')
        .filter(Boolean),
    )]

    return normalized.length > 0 ? normalized : this.defaultMutationDomains
  }

  private pickVariant(seedToken: string, field: string, variants: string[]) {
    if (variants.length === 0) {
      return ''
    }

    const hash = crypto
      .createHash('sha256')
      .update(`${seedToken}:${field}`)
      .digest()
    const index = hash.readUInt32BE(0) % variants.length
    return variants[index]
  }
}
