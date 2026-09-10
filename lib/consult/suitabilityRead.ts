import { consultSuitabilityCopy } from '@/lib/brand/consultSuitabilityCopy'
import 'server-only'
import { isDeepStrictEqual } from 'node:util'
import type { Prisma } from '@prisma/client'
import type { ConsultClientSuitabilityDTO, ConsultProSuitabilityDTO, ConsultSuitabilityEvidenceDTO } from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'
import { consultProProfileLabels } from '@/lib/brand/consultProProfileCopy'
import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'
import { normalizeStoredInspirationPayload } from './inspirationPack'
import { CONSULT_FACE_COLOR_SCHEMA_VERSION, CONSULT_FACE_COLOR_PROMPT_VERSION, sanitizeConsultFaceColorResponse } from './analysisEngine'
import { buildConsultSuitabilityContext, sanitizeConsultSuitabilityResponse,
  CONSULT_SUITABILITY_SCHEMA_VERSION, CONSULT_SUITABILITY_PROMPT_VERSION,
  type ConsultSuitabilityContext, type ConsultSuitabilitySource, type ConsultSuitabilityTranslation } from './suitabilityTranslation'

/** Rebuild through the original sanitizer; never trust persisted provider prose or provenance by casting JSON. */
export function normalizeStoredSuitability(payload: unknown, context: ConsultSuitabilityContext): ConsultSuitabilityTranslation | null {
  try {
    if (!isRecord(payload) || !Array.isArray(payload.tailoring) || !Array.isArray(payload.proConfirmations)) return null
    const sources = (value: unknown) => {
      if (!Array.isArray(value) || !value.every(isRecord)) throw new Error('Invalid citations')
      return value
    }
    const raw = {
      tailoring: payload.tailoring.map(item => {
        if (!isRecord(item)) throw new Error('Invalid tailoring')
        const citations = sources(item.sources)
        return { clientExplanation: item.clientExplanation, professionalDirection: item.professionalDirection,
          clientChoiceIds: citations.filter(s => s.provenance === 'CLIENT_REPORTED').map(s => s.id),
          observationIds: citations.filter(s => s.provenance === 'OBSERVED').map(s => s.id) }
      }),
      proConfirmations: payload.proConfirmations.map(item => {
        if (!isRecord(item)) throw new Error('Invalid confirmation')
        return { clientExplanation: item.clientExplanation, professionalCheck: item.professionalCheck,
          sourceIds: sources(item.sources).map(s => s.id) }
      }),
    }
    const normalized = sanitizeConsultSuitabilityResponse(raw, context)
    return isDeepStrictEqual(payload, normalized) ? normalized : null
  } catch { return null }
}

/** Caller must establish client/pro authorization before reaching this helper. */
export async function loadConsultSuitability(tx: Prisma.TransactionClient, consultSessionId: string, analysisRevisionId: string) {
  const row = await tx.consultSuitabilityTranslation.findFirst({
    where: { consultSessionId, analysisRevisionId },
    include: { analysisRevision: { include: { faceColorProfile: true } }, clientRevision: true },
  })
  if (!row || row.schemaVersion !== CONSULT_SUITABILITY_SCHEMA_VERSION || row.promptVersion !== CONSULT_SUITABILITY_PROMPT_VERSION) return null
  if (row.consultSessionId !== consultSessionId || row.analysisRevisionId !== analysisRevisionId ||
    row.analysisRevision.consultSessionId !== consultSessionId || row.clientRevision.consultSessionId !== consultSessionId ||
    row.analysisRevision.kind !== 'ANALYSIS' || row.clientRevision.kind !== 'INSPIRATION' ||
    row.clientRevision.revision >= row.analysisRevision.revision) return null
  // The Brief can temporarily show an older plan while newer preferences wait
  // for re-analysis. Do not pair that guidance with today's changed choices.
  const currentClientRevision = await tx.consultRevision.findFirst({ where: { consultSessionId, kind: 'INSPIRATION' }, orderBy: { revision: 'desc' }, select: { id: true } })
  if (currentClientRevision?.id !== row.clientRevisionId) return null
  try {
    const client = normalizeStoredInspirationPayload(row.clientRevision.payload)
    if (!client) return null
    const companion = row.analysisRevision.faceColorProfile
    const faceColor = companion && companion.schemaVersion === CONSULT_FACE_COLOR_SCHEMA_VERSION && companion.promptVersion === CONSULT_FACE_COLOR_PROMPT_VERSION
      ? { analysisRevisionId: companion.analysisRevisionId, profile: sanitizeConsultFaceColorResponse({ profile: companion.payload }) } : undefined
    const context = buildConsultSuitabilityContext({ analysisRevisionId, clientRevisionId: row.clientRevisionId,
      clientSource: 'INSPIRATION', clientChoices: client.exactClientDetails,
      analysis: normalizeStoredConsultAnalysisPayload(row.analysisRevision.payload, row.analysisRevision.schemaVersion), faceColor })
    return normalizeStoredSuitability(row.payload, context)
  } catch { return null }
}

const sourceLabels: Readonly<Record<string, string>> = { ...consultSuitabilityCopy.coreLabels, ...consultProProfileLabels }
function evidence(source: ConsultSuitabilitySource): ConsultSuitabilityEvidenceDTO {
  if (source.provenance === 'CLIENT_REPORTED') return { label: consultSuitabilityCopy.clientPreference, value: source.value, provenance: source.provenance, revisionId: source.revisionId }
  const field = source.id.split('.')[1] ?? ''
  return { label: sourceLabels[field] ?? field, value: source.value.replaceAll('_', ' ').toLowerCase(),
    provenance: source.provenance, revisionId: source.revisionId, confidence: source.confidence, evidence: source.evidence }
}
export function clientSuitability(translation: ConsultSuitabilityTranslation): ConsultClientSuitabilityDTO {
  return { analysisRevisionId: translation.analysisRevisionId, clientRevisionId: translation.clientRevisionId,
    whatYouLoved: translation.whatYouLoved.map(source => source.value),
    tailoring: translation.tailoring.map(item => ({ explanation: item.clientExplanation, needsConfirmation: item.status === 'NEEDS_PRO_CONFIRMATION' })),
    proConfirmations: translation.proConfirmations.map(item => item.clientExplanation) }
}
export function proSuitability(translation: ConsultSuitabilityTranslation): ConsultProSuitabilityDTO {
  return { analysisRevisionId: translation.analysisRevisionId, clientRevisionId: translation.clientRevisionId,
    whatYouLoved: translation.whatYouLoved.map(source => source.value),
    tailoring: translation.tailoring.map(item => ({ direction: item.professionalDirection, needsConfirmation: item.status === 'NEEDS_PRO_CONFIRMATION', sources: item.sources.map(evidence) })),
    proConfirmations: translation.proConfirmations.map(item => ({ check: item.professionalCheck, sources: item.sources.map(evidence) })) }
}
