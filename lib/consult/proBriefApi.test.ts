import { describe, expect, it } from 'vitest'

import { ProConsultBriefError } from './proBrief'
import { proConsultBriefErrorResponse } from './proBriefApi'

describe('pro consult brief API errors', () => {
  it('collapses hidden ownership and exposure failures to one stable 404', async () => {
    const response = proConsultBriefErrorResponse(
      new ProConsultBriefError('HIDDEN'),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Consult brief not found.',
      code: 'CONSULT_BRIEF_NOT_FOUND',
    })
  })

  it('redacts arbitrary provider and raw-object details from unexpected errors', async () => {
    const secret =
      'media-private/client/consult/hair_back.jpg base64=raw-provider-payload'
    const response = proConsultBriefErrorResponse(new Error(secret))
    const body = JSON.stringify(await response.json())

    expect(response.status).toBe(500)
    expect(body).toContain('CONSULT_BRIEF_UNAVAILABLE')
    expect(body).not.toContain(secret)
    expect(body).not.toContain('media-private')
    expect(body).not.toContain('hair_back.jpg')
    expect(body).not.toContain('raw-provider-payload')
  })
})
