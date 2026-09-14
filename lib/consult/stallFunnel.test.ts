// lib/consult/stallFunnel.test.ts
//
// The line this module draws is the one everything else depends on: WHOSE move
// is next. The nudge reads it to decide who may be contacted, and the daily
// report reads it to decide whether a pile of stalled consults is a product
// problem or an operational one. So it is pinned here, status by status, rather
// than left to a list nobody re-reads.

import { ConsultSessionStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  CONSULT_CLIENT_ACTION_STATUSES,
  CONSULT_STALL_STATUSES,
  isConsultAwaitingClient,
} from './stallFunnel'

describe('which consults count as stalled', () => {
  it('never counts a finished or withdrawn consult', () => {
    // COMPLETED is the goal. CANCELLED and CONSENT_REVOKED are the client's own
    // decision — counting those as a funnel leak would turn her withdrawing
    // consent into a metric, and nudging one would be worse.
    for (const status of [
      ConsultSessionStatus.COMPLETED,
      ConsultSessionStatus.CANCELLED,
      ConsultSessionStatus.CONSENT_REVOKED,
    ]) {
      expect(CONSULT_STALL_STATUSES).not.toContain(status)
    }
  })

  it('counts every other status exactly once', () => {
    const everyStatus = Object.values(ConsultSessionStatus)
    const terminal = new Set<ConsultSessionStatus>([
      ConsultSessionStatus.COMPLETED,
      ConsultSessionStatus.CANCELLED,
      ConsultSessionStatus.CONSENT_REVOKED,
    ])
    // 🔴 Derived from the enum, so a NEW lifecycle status fails this test rather
    // than quietly falling out of the funnel — the failure mode that made the
    // drop-off invisible in the first place was a consult nobody was counting.
    expect([...CONSULT_STALL_STATUSES].sort()).toEqual(
      everyStatus.filter((s) => !terminal.has(s)).sort(),
    )
    expect(new Set(CONSULT_STALL_STATUSES).size).toBe(
      CONSULT_STALL_STATUSES.length,
    )
  })
})

describe('🔴 whose move is next', () => {
  it('puts the analysis queue on OUR side of the line', () => {
    // ANALYSIS_PENDING is our cron; ANALYZING is our run, retryable from her
    // side but not something a reminder can fix. One real client burned four
    // analysis runs on 2026-09-11 and got nothing — telling her to finish would
    // have blamed her for our bug.
    expect(isConsultAwaitingClient(ConsultSessionStatus.ANALYSIS_PENDING)).toBe(
      false,
    )
    expect(isConsultAwaitingClient(ConsultSessionStatus.ANALYZING)).toBe(false)
  })

  it('puts every step she drives on HERS', () => {
    for (const status of [
      ConsultSessionStatus.CONSENT_REQUIRED,
      ConsultSessionStatus.EARLY_PHOTO_READY,
      ConsultSessionStatus.INTAKE_READY,
      ConsultSessionStatus.INTAKE_IN_PROGRESS,
      ConsultSessionStatus.MEDIA_READY,
    ]) {
      expect(isConsultAwaitingClient(status)).toBe(true)
    }
  })

  it('keeps the client-action set inside the stalled set', () => {
    for (const status of CONSULT_CLIENT_ACTION_STATUSES) {
      expect(CONSULT_STALL_STATUSES).toContain(status)
    }
  })

  it('is false for a status that is not stalled at all', () => {
    expect(isConsultAwaitingClient(ConsultSessionStatus.COMPLETED)).toBe(false)
    expect(isConsultAwaitingClient(ConsultSessionStatus.CANCELLED)).toBe(false)
  })
})
