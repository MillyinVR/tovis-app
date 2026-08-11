import { describe, expect, it } from 'vitest'

import { ClientConsultResultsError } from './clientResults'
import { clientConsultResultsErrorResponse } from './clientResultsApi'

describe('client consult results API errors', () => {
  it('collapses hidden ownership and exposure failures to one stable 404', async () => {
    for (const code of ['HIDDEN', 'NOT_FOUND'] as const) {
      const response = clientConsultResultsErrorResponse(
        new ClientConsultResultsError(code),
      )
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: 'Consult results not found.',
        code: 'CONSULT_RESULTS_NOT_FOUND',
      })
    }
  })

  it('returns a content-free unavailable response for payload/provider failures', async () => {
    const sensitive =
      'intake words model output recommendation safety storage/private/path.jpg'
    const response = clientConsultResultsErrorResponse(new Error(sensitive))
    expect(response.status).toBe(503)
    const body = JSON.stringify(await response.json())
    expect(body).toBe(
      JSON.stringify({
        ok: false,
        error: 'Consult results are unavailable.',
        code: 'CONSULT_RESULTS_UNAVAILABLE',
      }),
    )
    expect(body).not.toContain(sensitive)
  })
})
