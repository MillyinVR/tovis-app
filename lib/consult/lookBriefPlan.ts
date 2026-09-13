import type { ConsultAnalysisPayloadDTO, ConsultLookPlanDTO } from '@/lib/dto/consult'
import { normalizeStoredConsultLookPlan } from './lookPlan'

/** A pro-authored plan is separate from the immutable AI observations. */
export function effectiveConsultLookPlan(analysis: ConsultAnalysisPayloadDTO, version?: {
  professionalPlan?: unknown; invalidatedProfessionalPlan?: unknown
} | null): ConsultLookPlanDTO | undefined {
  if (version?.professionalPlan) return normalizeStoredConsultLookPlan(version.professionalPlan, analysis)
  if (version?.invalidatedProfessionalPlan && analysis.lookPlan) return { ...analysis.lookPlan,
    // The pro's plan no longer describes her, so there is nothing to choose
    // until they redo it — an empty path list, and no permission to book one.
    status: 'PRO_REVIEW', provisional: true, choosable: false, paths: [],
    nextStep: 'Your details changed. Your pro needs to review their previous plan before you choose a look.' }
  return analysis.lookPlan
}
