import 'server-only'
import type { Prisma } from '@prisma/client'
import type { ConsultBriefClientIntakeItemDTO, ConsultInspirationExactDetailDTO } from '@/lib/dto/consult'
import { consultIntakeItems, findConsultIntakePack, normalizeConsultIntakePayload } from './intake/registry'
import { normalizeStoredInspirationPayload } from './inspirationPack'

export const PRO_TRANSCRIPT_REVISION_SELECT = {
  id: true, consultSessionId: true, revision: true, kind: true,
  payload: true, schemaVersion: true, createdAt: true,
} satisfies Prisma.ConsultRevisionSelect

type Revision = Prisma.ConsultRevisionGetPayload<{ select: typeof PRO_TRANSCRIPT_REVISION_SELECT }>

type RevisionIdentity = {
  revisionId: string
  revision: number
  createdAt: string
}

export type ProTranscriptRevision = RevisionIdentity & (
  | { kind: 'INTAKE'; availability: 'AVAILABLE'; items: ConsultBriefClientIntakeItemDTO[] }
  | { kind: 'INSPIRATION'; availability: 'AVAILABLE'; details: ConsultInspirationExactDetailDTO[] }
  | { kind: 'INTAKE' | 'INSPIRATION'; availability: 'UNAVAILABLE' }
  | { kind: 'ANALYSIS' | 'BRIEF'; availability: 'REFERENCE_ONLY' }
)

/**
 * Internal projection foundation, not an authorization boundary or a full
 * transcript. The eventual loader must authorize the professional and consent
 * before querying. Follow-up rounds and rendered plan content are separate work.
 * Never return stored payloads, provider diagnostics, interpretation, or media.
 */
export function projectProTranscriptRevisions(
  consultSessionId: string,
  rows: readonly Revision[],
): ProTranscriptRevision[] {
  if (rows.some(row => row.consultSessionId !== consultSessionId)) {
    throw new Error('Consult transcript revision scope mismatch.')
  }
  return [...rows].sort((a, b) => a.revision - b.revision || a.id.localeCompare(b.id))
    .flatMap((row): ProTranscriptRevision[] => {
      const identity = {
        revisionId: row.id,
        revision: row.revision,
        createdAt: row.createdAt.toISOString(),
      }
      switch (row.kind) {
        case 'INTAKE': {
          const intake = normalizeConsultIntakePayload(row.payload)
          const pack = intake ? findConsultIntakePack(intake.packId, intake.packVersion) : null
          if (!intake || !pack || intake.schemaVersion !== row.schemaVersion) {
            return [{ ...identity, kind: row.kind, availability: 'UNAVAILABLE' }]
          }
          return [{ ...identity, kind: row.kind, availability: 'AVAILABLE', items: consultIntakeItems(pack, intake.answers) }]
        }
        case 'INSPIRATION': {
          const inspiration = normalizeStoredInspirationPayload(row.payload)
          if (!inspiration || inspiration.schemaVersion !== row.schemaVersion) {
            return [{ ...identity, kind: row.kind, availability: 'UNAVAILABLE' }]
          }
          return [{ ...identity, kind: row.kind, availability: 'AVAILABLE',
            details: inspiration.exactClientDetails.map(detail => ({
              questionKey: detail.questionKey, value: detail.value, sentiment: detail.sentiment, clientWords: detail.clientWords,
            })),
          }]
        }
        case 'ANALYSIS':
        case 'BRIEF':
          return [{ ...identity, kind: row.kind, availability: 'REFERENCE_ONLY' }]
        default:
          // INSPIRATION_ANALYSIS is provider-derived, not a client message.
          return []
      }
    })
}
