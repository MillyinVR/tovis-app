import { jsonFail } from '@/app/api/_utils'

import { ClientConsultResultsError } from './clientResults'

export function clientConsultResultsErrorResponse(error: unknown): Response {
  if (error instanceof ClientConsultResultsError) {
    if (error.code === 'HIDDEN' || error.code === 'NOT_FOUND') {
      return jsonFail(404, 'Consult results not found.', {
        code: 'CONSULT_RESULTS_NOT_FOUND',
      })
    }
  }

  // Deliberately stable and content-free: no revision payload, intake, safety
  // content, provider detail, capture reference, or private storage location.
  return jsonFail(503, 'Consult results are unavailable.', {
    code: 'CONSULT_RESULTS_UNAVAILABLE',
  })
}
