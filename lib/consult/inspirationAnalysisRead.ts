import type { Prisma } from '@prisma/client'

// lib/consult/inspirationAnalysisRead.ts
//
// Reading a STORED inspiration artefact back, and nothing else.
//
// Split out of lib/consult/inspirationAnalysisContract.ts in P5d because the
// inspiration STEP now needs it too: a card is a crop of this artefact, so
// `buildState` reads one on every inspiration load. Leaving the normalizer in
// the analysis contract would have made those two modules import each other —
// the analysis contract already imports the step's scope rules.
//
// It is a pure function of a row. No prisma, no locks, no provider: the write
// path and its lifecycle pins stay where they were.

import type { ConsultInspirationAnalysisDTO } from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'

import {
  CONSULT_INSPIRATION_ANALYSIS_FIELDS,
  CONSULT_INSPIRATION_FIELD_VALUES,
} from './inspirationAttributes'
import {
  CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION,
  CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION,
} from './inspirationVision'

/** The stored JSON → the typed artefact, or null when the row cannot be read. */
export function normalizeStoredConsultInspirationAnalysis(revision: {
  id: string
  payload: Prisma.JsonValue
  schemaVersion: number
  promptVersion: string | null
  model: string | null
  createdAt: Date
}): ConsultInspirationAnalysisDTO | null {
  const payload = revision.payload
  if (
    revision.schemaVersion !== CONSULT_INSPIRATION_ANALYSIS_SCHEMA_VERSION ||
    revision.promptVersion !== CONSULT_INSPIRATION_ANALYSIS_PROMPT_VERSION ||
    !revision.model ||
    !isRecord(payload) ||
    typeof payload.inspirationId !== 'string' ||
    !isRecord(payload.attributes)
  ) {
    return null
  }
  const source = (['PLATFORM_LOOK', 'BOOKED_PRO_LOOK', 'EXTERNAL_UPLOAD'] as const).find(
    (candidate) => candidate === payload.source,
  )
  if (!source) return null

  const attributes: Record<string, unknown> = {}
  for (const field of CONSULT_INSPIRATION_ANALYSIS_FIELDS) {
    const observed = payload.attributes[field]
    if (
      !isRecord(observed) ||
      typeof observed.value !== 'string' ||
      !CONSULT_INSPIRATION_FIELD_VALUES[field].includes(observed.value) ||
      !isRecord(observed.confidence) ||
      typeof observed.confidence.min !== 'number' ||
      typeof observed.confidence.max !== 'number' ||
      !Array.isArray(observed.evidence) ||
      observed.evidence.some((label) => label !== 'inspiration')
    ) {
      return null
    }
    let region: { x: number; y: number; w: number; h: number } | null = null
    if (observed.region !== null) {
      const raw = observed.region
      if (
        !isRecord(raw) ||
        typeof raw.x !== 'number' ||
        typeof raw.y !== 'number' ||
        typeof raw.w !== 'number' ||
        typeof raw.h !== 'number'
      ) {
        return null
      }
      region = { x: raw.x, y: raw.y, w: raw.w, h: raw.h }
    }
    attributes[field] = {
      value: observed.value,
      confidence: { min: observed.confidence.min, max: observed.confidence.max },
      evidence: observed.evidence.filter(
        (label): label is 'inspiration' => label === 'inspiration',
      ),
      region,
    }
  }

  return {
    revisionId: revision.id,
    inspirationId: payload.inspirationId,
    source,
    schemaVersion: revision.schemaVersion,
    promptVersion: revision.promptVersion,
    model: revision.model,
    // The per-field loop above proved every field; the object it built is the
    // DTO's attribute set by construction.
    attributes: attributes as ConsultInspirationAnalysisDTO['attributes'],
    createdAt: revision.createdAt.toISOString(),
  }
}
