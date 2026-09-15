import { ConsultProviderCallKind } from '@prisma/client'
import { readOptionalEnv } from '@/lib/env'
import { analysisModel, requestConsultAnalysisJson } from './analysisEngine'
import { ConsultAnalysisProviderError } from './analysisValidation'
import type { ConsultCaptureImage } from './captureStorage'
import { compareConsultHairMaps, type ConsultHairComparison } from './hairComparison'
import { buildConsultHairMapSchema, CONSULT_HAIR_MAP_INSTRUCTIONS, sanitizeConsultHairMap, type ConsultHairMapScope, type ConsultHairMapView } from './hairMap'
import type { ConsultProviderMeterSink } from './providerMeter'

export const CONSULT_HAIR_MAP_TIMEOUT_MS = 30_000
export const CONSULT_HAIR_MAP_LATEST_START_MS = 90_000
export type ConsultHairMapImage = { view: ConsultHairMapView; image: ConsultCaptureImage }
export type ConsultHairMapProvider = (args: {
  scope: ConsultHairMapScope; images: readonly ConsultHairMapImage[]; meter?: ConsultProviderMeterSink
}) => Promise<{ raw: unknown; model: string }>
export type ConsultHairComparisonResult = { comparison: ConsultHairComparison; model: string }

export const runConsultHairMap: ConsultHairMapProvider = async ({ scope, images, meter }) => {
  if (images.length !== scope.views.length || images.some((image, index) => image.view !== scope.views[index])) {
    throw new ConsultAnalysisProviderError('bad_output', 'hair_map_image_scope')
  }
  const model = analysisModel()
  const raw = await requestConsultAnalysisJson({
    model, system: CONSULT_HAIR_MAP_INSTRUCTIONS,
    content: [
      { type: 'text', text: `Role: ${scope.role}. Colour-uncertain views: ${JSON.stringify(scope.colorUncertainViews ?? [])}.` },
      ...images.flatMap(({ view, image }) => [
        { type: 'text' as const, text: `View: ${view}` },
        { type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 } },
      ]),
    ],
    schema: buildConsultHairMapSchema(scope), maxTokens: 6_000,
    timeoutMs: CONSULT_HAIR_MAP_TIMEOUT_MS, kind: ConsultProviderCallKind.ANALYSIS_HAIR_MAP, meter,
    validate: raw => { sanitizeConsultHairMap(raw, scope) },
  })
  return { raw, model }
}

/**
 * Two bounded, independently scoped image calls, overlapped with the existing
 * feature read. No retries or new uploads; a failure preserves the old path.
 * The reference never enters the client's feature/skin analysis.
 */
export async function optionalConsultHairComparison(args: {
  family: string; lookPlanning: boolean; startedAt: number
  current: readonly ConsultHairMapImage[]
  colorUncertainViews: readonly ConsultHairMapView[]
  loadReference?: () => Promise<ConsultCaptureImage>
  referenceReadDisabled?: boolean
  referenceMap?: { model: string; map: import('./hairMap').ConsultHairMap }
  meter?: ConsultProviderMeterSink; provider?: ConsultHairMapProvider
}): Promise<ConsultHairComparisonResult | undefined> {
  if (args.referenceReadDisabled && !args.referenceMap) return
  if (readOptionalEnv('AI_CONSULT_HAIR_MAP_ENABLED') !== 'true' || args.family !== 'HAIR' || !args.lookPlanning || (!args.loadReference && !args.referenceMap) || !args.current.length) return
  if (Date.now() - args.startedAt >= CONSULT_HAIR_MAP_LATEST_START_MS) return
  try {
    const provider = args.provider ?? runConsultHairMap
    const currentScope: ConsultHairMapScope = { role: 'CURRENT', views: args.current.map(image => image.view), colorUncertainViews: args.colorUncertainViews }
    const referenceScope: ConsultHairMapScope = { role: 'REFERENCE', views: ['inspiration'] }
    // Validate both scopes before spending. The schema builder checks isolation.
    buildConsultHairMapSchema(currentScope)
    buildConsultHairMapSchema(referenceScope)
    const loadReference = args.loadReference
    const [current, reference] = await Promise.allSettled([
      provider({ scope: currentScope, images: args.current, meter: args.meter }),
      (async () => {
        if (args.referenceMap) return { model: args.referenceMap.model, raw: args.referenceMap.map }
        if (!loadReference) throw new ConsultAnalysisProviderError('unavailable', 'hair_map_reference')
        const image = await loadReference()
        if (Date.now() - args.startedAt >= CONSULT_HAIR_MAP_LATEST_START_MS + 20_000) {
          throw new ConsultAnalysisProviderError('unavailable', 'hair_map_deadline')
        }
        return provider({ scope: referenceScope, images: [{ view: 'inspiration', image }], meter: args.meter })
      })(),
    ])
    if (current.status === 'rejected') throw current.reason
    if (reference.status === 'rejected') throw reference.reason
    const model = current.value.model
    if (!model.trim() || model !== model.trim() || model.length > 128 || model !== reference.value.model) {
      throw new ConsultAnalysisProviderError('bad_output', 'hair_map_model')
    }
    return { model, comparison: compareConsultHairMaps(
      sanitizeConsultHairMap(current.value.raw, currentScope),
      sanitizeConsultHairMap(reference.value.raw, referenceScope),
    ) }
  } catch (error) {
    console.warn('consult hair comparison unavailable', {
      kind: error instanceof ConsultAnalysisProviderError ? error.kind : 'unavailable',
      check: error instanceof ConsultAnalysisProviderError ? error.check : null,
    })
    return undefined
  }
}
