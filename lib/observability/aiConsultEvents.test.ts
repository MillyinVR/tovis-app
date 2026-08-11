import { afterEach, describe, expect, it, vi } from 'vitest'

import { logAiConsultServe } from './aiConsultEvents'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AI consult serve-log privacy boundary', () => {
  it('records completion, retake, and booking attribution without raw identifiers or content fields', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const consultId = 'consult_private_goal_words'
    const clientId = 'client_private_trait_words'

    logAiConsultServe({
      metric: 'CLIENT_RESULTS',
      consultId,
      clientId,
      firstServe: true,
      acceptedPhotoCount: 4,
      retakeCount: 2,
      bookingAttributed: true,
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const line = String(spy.mock.calls[0]?.[0])
    const payload: unknown = JSON.parse(line)
    expect(payload).toMatchObject({
      namespace: 'ai_consult',
      event: 'ai_consult_serve',
      metric: 'CLIENT_RESULTS',
      completed: true,
      firstServe: true,
      acceptedPhotoCount: 4,
      retakeCount: 2,
      bookingAttributed: true,
    })
    expect(line).not.toContain(consultId)
    expect(line).not.toContain(clientId)
    for (const forbidden of [
      'intake',
      'recommendation',
      'safety',
      'storagePath',
      'storageBucket',
      'captureId',
      'modelOutput',
      'undertone',
      'skinTone',
    ]) {
      expect(line).not.toContain(forbidden)
    }
  })

  it('records a first locked-teaser tap without implying entitlement or unlock', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logAiConsultServe({
      metric: 'ME_CARD_TEASER_TAP',
      consultId: 'consult_1',
      clientId: 'client_1',
      firstTap: true,
    })

    const payload: unknown = JSON.parse(String(spy.mock.calls[0]?.[0]))
    expect(payload).toMatchObject({
      metric: 'ME_CARD_TEASER_TAP',
      firstTap: true,
      teaserLocked: true,
    })
    expect(JSON.stringify(payload)).not.toMatch(/entitle|member|unlocked/i)
  })
})
