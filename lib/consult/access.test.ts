// lib/consult/access.test.ts
import { afterEach, describe, expect, it } from 'vitest'

import {
  AI_CONSULT_C5_LIVE_BASELINE_APPROVED,
  AI_CONSULT_C5_LIVE_CANDIDATE_PASSED,
  AI_CONSULT_PRO_ALLOWLIST,
  evaluateAiConsultC6Exposure,
  isAiConsultC6ExposureEnabledForPro,
  isAiConsultC6ExposurePossible,
  isAiConsultEnabledForPro,
} from './access'

describe('isAiConsultEnabledForPro', () => {
  afterEach(() => {
    delete process.env.ENABLE_AI_CONSULT
  })

  it('is off by default and for a non-allowlisted pro', () => {
    expect(isAiConsultEnabledForPro(undefined)).toBe(false)
    expect(isAiConsultEnabledForPro(null)).toBe(false)
    expect(isAiConsultEnabledForPro('not-on-the-list')).toBe(false)
    process.env.ENABLE_AI_CONSULT = '0'
    expect(isAiConsultEnabledForPro('not-on-the-list')).toBe(false)
    process.env.ENABLE_AI_CONSULT = 'off'
    expect(isAiConsultEnabledForPro('not-on-the-list')).toBe(false)
  })

  it('global flag on enables every pro', () => {
    for (const v of ['1', 'true', 'YES']) {
      process.env.ENABLE_AI_CONSULT = v
      expect(isAiConsultEnabledForPro('anyone')).toBe(true)
      expect(isAiConsultEnabledForPro(undefined)).toBe(false)
      expect(isAiConsultEnabledForPro(null)).toBe(false)
    }
  })

  it('allowlisted pros are enabled even with the global flag off', () => {
    // Guard for the temporary pilot allowlist while it is non-empty.
    if (AI_CONSULT_PRO_ALLOWLIST.length > 0) {
      const id = AI_CONSULT_PRO_ALLOWLIST[0]!
      expect(isAiConsultEnabledForPro(id)).toBe(true)
    }
  })

  it('fails closed for C6 while either required live C5 artifact is absent', () => {
    expect(AI_CONSULT_C5_LIVE_BASELINE_APPROVED).toBe(false)
    expect(AI_CONSULT_C5_LIVE_CANDIDATE_PASSED).toBe(false)
    process.env.ENABLE_AI_CONSULT = 'true'
    expect(isAiConsultC6ExposureEnabledForPro('anyone')).toBe(false)
    expect(isAiConsultC6ExposurePossible()).toBe(false)

    expect(
      evaluateAiConsultC6Exposure({
        founderEnabled: true,
        liveBaselineApproved: false,
        liveCandidatePassed: true,
      }),
    ).toBe(false)
    expect(
      evaluateAiConsultC6Exposure({
        founderEnabled: true,
        liveBaselineApproved: true,
        liveCandidatePassed: false,
      }),
    ).toBe(false)
    expect(
      evaluateAiConsultC6Exposure({
        founderEnabled: false,
        liveBaselineApproved: true,
        liveCandidatePassed: true,
      }),
    ).toBe(false)
  })
})
