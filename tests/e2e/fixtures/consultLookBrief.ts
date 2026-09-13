import type { ConsultLookBriefVersionDTO, ConsultLookPlanDTO } from '@/lib/dto/consult'
export const plan: ConsultLookPlanDTO = {
  schemaVersion: 1, tier: 'EXACT', status: 'READY_TO_CHOOSE', provisional: false, choosable: true, safetyRouted: false,
  summary: 'Warm dimension and movement while keeping your length.', nextStep: 'Choose the direction you love.',
  paths: [{ title: 'Buttery blonde with soft layers', whyThisWorksForYou: 'Keeps your natural root and the length you love.',
    featureEvidence: [], sessionCount: 2, visits: [0, 1].map(() => ({ steps: [
      { offeringId: 'color', serviceId: 'color', serviceCategoryId: 'hair-color', serviceName: 'Internal dimensional color service' },
    ] })) }],
}
const amount = { price: '180.00', knownSubtotal: '180.00', priceStatus: 'PAID' as const, durationMinutes: 90 }
export const brief: ConsultLookBriefVersionDTO = {
  id: 'brief-3', version: 3, sourceAnalysisRevisionId: 'analysis-1', bookingId: null,
  confirmationOpen: true, inputOpen: true, completedVisit: null, professionalPlan: null,
  professionalPlanReason: null, invalidatedProfessionalPlan: false, invalidatedAdjustments: [],
  awaitingAnalysis: false, changes: [], additionalClientAnswers: [], selectedPathIndex: null, selectedLocationType: null,
  clientConfirmed: false, professionalConfirmed: true, reservedDurationMinutes: null,
  adjustments: [{ field: 'EXPECTATIONS', pathIndex: 0, visitIndex: null, offeringId: null, locationType: null,
    value: 'Warm and buttery, with your natural root.', reason: null, professionalId: 'pro' }],
  pathEstimates: [{ pathIndex: 0, locationType: 'SALON', firstAppointment: amount,
    transformation: { ...amount, price: '360.00', knownSubtotal: '360.00', durationMinutes: 180 },
    visits: [0, 1].map(() => ({ ...amount, steps: [{ ...amount, offeringId: 'color', serviceId: 'color', available: true }] })) }],
}
