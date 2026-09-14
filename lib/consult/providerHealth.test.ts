import { ConsultProviderCallKind } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  consultProviderHealthAlerts,
  type ConsultProviderHealthKindRow,
} from './providerHealth'

const thresholds = { minSample: 4, maxFailureRate: 0.25 }

function row(
  overrides: Partial<ConsultProviderHealthKindRow> &
    Pick<ConsultProviderHealthKindRow, 'kind' | 'totalCalls' | 'failedCalls'>,
): ConsultProviderHealthKindRow {
  const { totalCalls, failedCalls } = overrides
  return {
    okCalls: totalCalls - failedCalls,
    badOutputCalls: failedCalls,
    failureRate: totalCalls === 0 ? 0 : failedCalls / totalCalls,
    costMicroUsd: 0,
    topFailureChecks: [],
    ...overrides,
  }
}

describe('consultProviderHealthAlerts', () => {
  it('alerts on the real 2026-09-13 inspiration-read numbers', () => {
    // 4 BAD_OUTPUT in 9 calls — the rate that had been true for days and was
    // never reported to anyone. This is the case the job exists for.
    const alerts = consultProviderHealthAlerts(
      [
        row({
          kind: ConsultProviderCallKind.INSPIRATION_READ,
          totalCalls: 9,
          failedCalls: 4,
          topFailureChecks: [{ check: 'region_containment', count: 3 }],
        }),
      ],
      thresholds,
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      kind: ConsultProviderCallKind.INSPIRATION_READ,
      failedCalls: 4,
      totalCalls: 9,
      topFailureChecks: [{ check: 'region_containment', count: 3 }],
    })
  })

  it('stays quiet on a healthy kind', () => {
    expect(
      consultProviderHealthAlerts(
        [row({ kind: ConsultProviderCallKind.CAPTURE_GATE, totalCalls: 20, failedCalls: 1 })],
        thresholds,
      ),
    ).toEqual([])
  })

  it('does not alert on a 100% failure rate below the sample floor', () => {
    // 1-for-1 is the shape that would page on the first bad call of a quiet
    // morning. It is a real failure and it belongs in the log line, but it is
    // not yet a rate.
    expect(
      consultProviderHealthAlerts(
        [row({ kind: ConsultProviderCallKind.FOLLOW_UP_QUESTIONS, totalCalls: 1, failedCalls: 1 })],
        thresholds,
      ),
    ).toEqual([])
  })

  it('alerts once the sample floor is reached', () => {
    expect(
      consultProviderHealthAlerts(
        [row({ kind: ConsultProviderCallKind.FOLLOW_UP_QUESTIONS, totalCalls: 4, failedCalls: 4 })],
        thresholds,
      ),
    ).toHaveLength(1)
  })

  it('treats the threshold as inclusive', () => {
    expect(
      consultProviderHealthAlerts(
        [row({ kind: ConsultProviderCallKind.ANALYSIS_PROFILE, totalCalls: 8, failedCalls: 2 })],
        thresholds,
      ),
    ).toHaveLength(1)
  })

  it('ranks the worst kind first', () => {
    const alerts = consultProviderHealthAlerts(
      [
        row({ kind: ConsultProviderCallKind.ANALYSIS_PROFILE, totalCalls: 10, failedCalls: 3 }),
        row({ kind: ConsultProviderCallKind.INSPIRATION_READ, totalCalls: 10, failedCalls: 8 }),
      ],
      thresholds,
    )
    expect(alerts.map((alert) => alert.kind)).toEqual([
      ConsultProviderCallKind.INSPIRATION_READ,
      ConsultProviderCallKind.ANALYSIS_PROFILE,
    ])
  })

  it('never divides by zero on an idle window', () => {
    expect(
      consultProviderHealthAlerts(
        [row({ kind: ConsultProviderCallKind.ANALYSIS_DIRECTION, totalCalls: 0, failedCalls: 0 })],
        thresholds,
      ),
    ).toEqual([])
  })
})
