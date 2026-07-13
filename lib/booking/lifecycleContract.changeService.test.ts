// lib/booking/lifecycleContract.changeService.test.ts
import { describe, expect, it } from 'vitest'
import { SessionStep } from '@prisma/client'

import { assertLegalStepTransition } from './lifecycleContract'

// §22 MS1 — a pre-capture mid-session service change re-opens the consultation,
// dropping a post-consultation step back to CONSULTATION_PENDING_CLIENT for the
// client to re-approve. Both post-consult steps must allow that for the PRO,
// and only the PRO (a client can't reopen from these steps).
describe('§22 MS1 change-service reopen transitions', () => {
  it('allows a PRO to reopen from BEFORE_PHOTOS', () => {
    expect(() =>
      assertLegalStepTransition(
        SessionStep.BEFORE_PHOTOS,
        SessionStep.CONSULTATION_PENDING_CLIENT,
        'PRO',
      ),
    ).not.toThrow()
  })

  it('allows a PRO to reopen from SERVICE_IN_PROGRESS', () => {
    expect(() =>
      assertLegalStepTransition(
        SessionStep.SERVICE_IN_PROGRESS,
        SessionStep.CONSULTATION_PENDING_CLIENT,
        'PRO',
      ),
    ).not.toThrow()
  })

  it('still rejects a CLIENT reopening the consultation from those steps', () => {
    expect(() =>
      assertLegalStepTransition(
        SessionStep.BEFORE_PHOTOS,
        SessionStep.CONSULTATION_PENDING_CLIENT,
        'CLIENT',
      ),
    ).toThrow()
  })
})
