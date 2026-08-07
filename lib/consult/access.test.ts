// lib/consult/access.test.ts
import { afterEach, describe, expect, it } from 'vitest'

import { AI_CONSULT_PRO_ALLOWLIST, isAiConsultEnabledForPro } from './access'

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
})
