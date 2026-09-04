import type { Prisma } from '@prisma/client'

import type {
  ConsultAnalysisPayloadDTO,
  ConsultAnalysisResultDTO,
} from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'

import {
  CONSULT_ANALYSIS_SCHEMA_VERSION,
  validateConsultAnalysisResult,
} from './analysisEngine'
import { ConsultWriteError } from './errors'

/** The last schema whose rows carried `hairColorLens` and colour-only intents. */
export const LEGACY_HAIR_COLOR_ANALYSIS_SCHEMA_VERSION = 2

function unavailable(): never {
  throw new ConsultWriteError('ANALYSIS_UNAVAILABLE', 'Analysis is unavailable.')
}

/**
 * Schema 2 → 3, on read. A row written under the colour-only schema keeps
 * loading: its lens moves under the service-neutral key, and its colour intent
 * becomes the kind of recommendation it was — a menu service (the colour
 * pipeline matched by name pattern, so no exact menu name survives), the
 * professional review, or one of the two safety tests.
 *
 * No production row has ever been written under schema 2 (0 ANALYSIS
 * revisions on 2026-09-03), so this is a reader for fixtures and for the
 * guarantee, not a migration path anyone has walked.
 */
function upgradeLegacyPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(payload.recommendations)) unavailable()
  const { hairColorLens, core, ...rest } = payload
  return {
    ...rest,
    core: upgradeLegacyCore(core),
    serviceLens: hairColorLens,
    recommendations: payload.recommendations.map((item) => {
      if (!isRecord(item) || typeof item.serviceIntent !== 'string') unavailable()
      const { serviceIntent, ...fields } = item
      const kind =
        serviceIntent === 'PATCH_TEST' || serviceIntent === 'STRAND_TEST'
          ? serviceIntent
          : serviceIntent === 'COLOR_CONSULTATION'
            ? 'CONSULTATION'
            : 'SERVICE'
      return {
        ...fields,
        serviceIntent: kind,
        // The colour pipeline matched a menu row by pattern, never by name;
        // the stored REFERENCE (kept below) still says which service it was.
        serviceName: kind === 'SERVICE' ? 'Service from the professional’s menu' : null,
      }
    }),
  }
}

/**
 * Schema 2's `core.currentLevel: { min, max }` → schema 4's two named levels.
 *
 * 🔴 One assumption, stated rather than buried: `min` is read as the BASE and
 * `max` as the LIGHTEST. The old field never said which it meant — that
 * ambiguity is the whole reason for the rename (lib/consult/hairLevel.ts) —
 * but it is the reading the client screen already rendered ("Levels 5–7"), so
 * it is the one a stored row's reader would have to honour. It applies to no
 * real data: production has never held an analysis revision of ANY version,
 * because the schema did not compile until v5.
 */
function upgradeLegacyCore(core: unknown): unknown {
  if (!isRecord(core) || !isRecord(core.currentLevel)) return core
  const { currentLevel, ...rest } = core
  const { min, max, ...shared } = currentLevel
  const level = (value: unknown): Record<string, unknown> => ({
    ...shared,
    value:
      typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10
        ? `LEVEL_${value}`
        : 'UNKNOWN',
  })
  return { baseLevel: level(min), lightestLevel: level(max), ...rest }
}

export function normalizeStoredConsultAnalysisPayload(
  payload: Prisma.JsonValue,
  schemaVersion: number = CONSULT_ANALYSIS_SCHEMA_VERSION,
): ConsultAnalysisPayloadDTO {
  if (!isRecord(payload)) unavailable()
  const current =
    schemaVersion === LEGACY_HAIR_COLOR_ANALYSIS_SCHEMA_VERSION
      ? upgradeLegacyPayload(payload)
      : schemaVersion === CONSULT_ANALYSIS_SCHEMA_VERSION
        ? payload
        : unavailable()
  if (!Array.isArray(current.recommendations)) unavailable()
  const references: ConsultAnalysisPayloadDTO['recommendations'][number]['reference'][] = []
  const storedRecommendations = current.recommendations.map((item) => {
    if (!isRecord(item) || !isRecord(item.reference)) unavailable()
    const reference = item.reference
    const referenceKeys = Object.keys(reference).sort().join(',')
    if (
      referenceKeys !== 'serviceCategoryId,serviceId,type' ||
      typeof reference.serviceCategoryId !== 'string' ||
      !reference.serviceCategoryId
    ) {
      unavailable()
    }
    if (
      reference.type === 'SERVICE' &&
      typeof reference.serviceId === 'string' &&
      reference.serviceId
    ) {
      references.push({
        type: 'SERVICE',
        serviceId: reference.serviceId,
        serviceCategoryId: reference.serviceCategoryId,
      })
    } else if (
      reference.type === 'SERVICE_CATEGORY' &&
      reference.serviceId === null
    ) {
      references.push({
        type: 'SERVICE_CATEGORY',
        serviceId: null,
        serviceCategoryId: reference.serviceCategoryId,
      })
    } else {
      unavailable()
    }
    return {
      serviceIntent: item.serviceIntent,
      serviceName: item.serviceName,
      title: item.title,
      rationale: item.rationale,
      achievability: item.achievability,
      discussWithProfessional: item.discussWithProfessional,
    }
  })

  let sanitized
  try {
    sanitized = validateConsultAnalysisResult({
      model: 'stored-analysis',
      analysis: {
        profile: current.profile,
        styleDirections: current.styleDirections,
        core: current.core,
        serviceLens: current.serviceLens,
        safetyFlags: current.safetyFlags,
        recommendations: storedRecommendations,
      },
    }).analysis
  } catch {
    unavailable()
  }

  return {
    ...sanitized,
    recommendations: sanitized.recommendations.map((recommendation, index) => {
      const reference = references[index]
      if (!reference) unavailable()
      return { ...recommendation, reference }
    }),
  }
}

export function mapStoredConsultAnalysisRevision(revision: {
  id: string
  revision: number
  payload: Prisma.JsonValue
  schemaVersion: number
  createdAt: Date
}): ConsultAnalysisResultDTO {
  return {
    revisionId: revision.id,
    revision: revision.revision,
    analysis: normalizeStoredConsultAnalysisPayload(
      revision.payload,
      revision.schemaVersion,
    ),
    createdAt: revision.createdAt.toISOString(),
  }
}
