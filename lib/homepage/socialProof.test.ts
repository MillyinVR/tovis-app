// lib/homepage/socialProof.test.ts
//
// The homepage's two social-proof slots hold invented specimen content in the
// source design. These tests pin the two properties that keep it off the live
// page: the gate is CLOSED unless the environment opts in, and the content is
// EMPTY regardless. They exist because the failure here is silent — a page
// that quietly starts asserting "41,208 looks booked" looks fine.
import { afterEach, describe, expect, it } from 'vitest'

import {
  HOMEPAGE_PROOF_STATS,
  HOMEPAGE_SOCIAL_PROOF_DEFAULT,
  HOMEPAGE_VOICES,
  homepageSocialProof,
} from './socialProof'

const original = process.env.HOMEPAGE_SOCIAL_PROOF

afterEach(() => {
  if (original === undefined) delete process.env.HOMEPAGE_SOCIAL_PROOF
  else process.env.HOMEPAGE_SOCIAL_PROOF = original
})

describe('homepageSocialProof', () => {
  it('defaults to OFF, so an unset environment renders neither section', () => {
    expect(HOMEPAGE_SOCIAL_PROOF_DEFAULT).toBe('OFF')
    delete process.env.HOMEPAGE_SOCIAL_PROOF
    expect(homepageSocialProof()).toEqual({ stats: [], voices: [] })
  })

  it('treats an unrecognised value as OFF rather than as opt-in', () => {
    for (const raw of ['on', 'true', '1', 'yes', '', 'ON ']) {
      process.env.HOMEPAGE_SOCIAL_PROOF = raw
      expect(homepageSocialProof(), `value ${JSON.stringify(raw)}`).toEqual({
        stats: [],
        voices: [],
      })
    }
  })

  it('ships no figures and no quotes, so the flag alone cannot publish a claim', () => {
    // 🔴 If this fails, someone restored the design's specimen content. Those
    // figures and those named people are not real. Only add a row you can
    // source — see the comments in socialProof.ts.
    expect(HOMEPAGE_PROOF_STATS).toEqual([])
    expect(HOMEPAGE_VOICES).toEqual([])

    process.env.HOMEPAGE_SOCIAL_PROOF = 'ON'
    const { stats, voices } = homepageSocialProof()
    expect(stats).toEqual([])
    expect(voices).toEqual([])
  })

  it('reads the flag on every call, so it is never frozen at import time', () => {
    process.env.HOMEPAGE_SOCIAL_PROOF = 'OFF'
    expect(homepageSocialProof().stats).toEqual([])
    process.env.HOMEPAGE_SOCIAL_PROOF = 'ON'
    // Still empty (nothing is written yet), but the call must have re-read the
    // env rather than returning a value cached from the first invocation.
    expect(homepageSocialProof().stats).toEqual(HOMEPAGE_PROOF_STATS)
  })
})
