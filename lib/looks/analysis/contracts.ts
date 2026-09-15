import type { LookMediaAnalysisStatus, MediaType } from '@prisma/client'
import type { ConsultInspirationAnalysisField } from '@/lib/consult/inspirationAttributes'

export type LookAnalysisQuestion = { key: string; label: string; options: Array<{ value: string; label: string }> }
export type LookAnalysisObservation = { value: string; confidence: { min: number; max: number }; region: { x: number; y: number; w: number; h: number } | null }
export type LookAnalysisItem = {
  id: string; mediaAssetId: string; status: LookMediaAnalysisStatus; revision: number
  mediaType: MediaType; caption: string | null; selectedFrame: number; frameCount: number
  frameReadBase: string; questions: LookAnalysisQuestion[]; answers: Record<string, string>
  observations: Partial<Record<ConsultInspirationAnalysisField, LookAnalysisObservation>>
  reviewedObservations?: Partial<Record<ConsultInspirationAnalysisField, LookAnalysisObservation>>
  flags: string[]; failure: string | null; reviewedByUserId: string | null
}
export type LookAnalysisMutation = {
  revision: number; action: 'answer' | 'approve' | 'reject' | 'retry'
  selectedFrame?: number; answers?: Record<string, string>
  corrections?: Partial<Record<ConsultInspirationAnalysisField, LookAnalysisObservation>>
}
