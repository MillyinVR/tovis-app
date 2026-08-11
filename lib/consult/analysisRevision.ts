import type { Prisma } from '@prisma/client'

import type {
  ConsultAnalysisPayloadDTO,
  ConsultAnalysisResultDTO,
} from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'

import { validateHairColorAnalysisProviderResult } from './analysisEngine'
import { ConsultWriteError } from './errors'

export function normalizeStoredHairColorAnalysisPayload(
  payload: Prisma.JsonValue,
): ConsultAnalysisPayloadDTO {
  if (!isRecord(payload) || !Array.isArray(payload.recommendations)) {
    throw new ConsultWriteError('ANALYSIS_UNAVAILABLE', 'Analysis is unavailable.')
  }
  const references: ConsultAnalysisPayloadDTO['recommendations'][number]['reference'][] = []
  const providerRecommendations = payload.recommendations.map((item) => {
    if (!isRecord(item) || !isRecord(item.reference)) {
      throw new ConsultWriteError('ANALYSIS_UNAVAILABLE', 'Analysis is unavailable.')
    }
    const reference = item.reference
    const referenceKeys = Object.keys(reference).sort().join(',')
    if (
      referenceKeys !== 'serviceCategoryId,serviceId,type' ||
      typeof reference.serviceCategoryId !== 'string' ||
      !reference.serviceCategoryId
    ) {
      throw new ConsultWriteError('ANALYSIS_UNAVAILABLE', 'Analysis is unavailable.')
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
      throw new ConsultWriteError('ANALYSIS_UNAVAILABLE', 'Analysis is unavailable.')
    }
    return {
      serviceIntent: item.serviceIntent,
      title: item.title,
      rationale: item.rationale,
      achievability: item.achievability,
      discussWithProfessional: item.discussWithProfessional,
    }
  })

  let sanitized
  try {
    sanitized = validateHairColorAnalysisProviderResult({
      model: 'stored-analysis',
      analysis: {
        core: payload.core,
        hairColorLens: payload.hairColorLens,
        safetyFlags: payload.safetyFlags,
        recommendations: providerRecommendations,
      },
    }).analysis
  } catch {
    throw new ConsultWriteError('ANALYSIS_UNAVAILABLE', 'Analysis is unavailable.')
  }

  return {
    ...sanitized,
    recommendations: sanitized.recommendations.map((recommendation, index) => {
      const reference = references[index]
      if (!reference) {
        throw new ConsultWriteError('ANALYSIS_UNAVAILABLE', 'Analysis is unavailable.')
      }
      return { ...recommendation, reference }
    }),
  }
}

export function mapStoredHairColorAnalysisRevision(revision: {
  id: string
  revision: number
  payload: Prisma.JsonValue
  createdAt: Date
}): ConsultAnalysisResultDTO {
  return {
    revisionId: revision.id,
    revision: revision.revision,
    analysis: normalizeStoredHairColorAnalysisPayload(revision.payload),
    createdAt: revision.createdAt.toISOString(),
  }
}
