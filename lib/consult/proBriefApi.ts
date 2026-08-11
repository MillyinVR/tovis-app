import { jsonFail } from '@/app/api/_utils'

import { ProConsultBriefError } from './proBrief'

export function proConsultBriefErrorResponse(error: unknown): Response {
  if (error instanceof ProConsultBriefError) {
    switch (error.code) {
      case 'HIDDEN':
      case 'NOT_FOUND':
        return jsonFail(404, 'Consult brief not found.', {
          code: 'CONSULT_BRIEF_NOT_FOUND',
        })
      case 'INVALID_RATING':
        return jsonFail(400, 'Invalid consult brief request.', {
          code: 'CONSULT_BRIEF_INVALID_REQUEST',
        })
      case 'RATING_CONFLICT':
        return jsonFail(409, 'Consult brief feedback is already recorded.', {
          code: 'CONSULT_BRIEF_RATING_CONFLICT',
        })
      case 'UNAVAILABLE':
        return jsonFail(503, 'Consult brief is unavailable.', {
          code: 'CONSULT_BRIEF_UNAVAILABLE',
        })
    }
  }

  // Deliberately content-free: provider errors, payloads, and ephemeral C3
  // object locations must never escape through a C6 API error.
  return jsonFail(500, 'Consult brief is unavailable.', {
    code: 'CONSULT_BRIEF_UNAVAILABLE',
  })
}
