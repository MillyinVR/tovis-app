import { describe, expect, it } from 'vitest'

import type { ConsultAnalysisRunDTO } from '@/lib/dto/consult'

import {
  consultAnalysisRunProgress,
  isConsultAnalysisRunLive,
} from './analysisRunCopy'

function run(overrides: Partial<ConsultAnalysisRunDTO> = {}): ConsultAnalysisRunDTO {
  return {
    runId: 'run_1',
    status: 'RUNNING',
    stage: 'READING_PHOTOS',
    photoCount: 4,
    attemptCount: 1,
    maxAttempts: 3,
    queuedAt: '2026-09-04T00:00:00.000Z',
    startedAt: '2026-09-04T00:00:01.000Z',
    finishedAt: null,
    failureCode: null,
    retryable: false,
    ...overrides,
  }
}

describe('consult analysis run copy', () => {
  it('names the number of photos it is actually reading', () => {
    expect(consultAnalysisRunProgress(run({ photoCount: 4 })).headline).toBe(
      'Reading your 4 photos…',
    )
    // A partial pack is a supported state, so the singular has to exist.
    expect(consultAnalysisRunProgress(run({ photoCount: 1 })).headline).toBe(
      'Reading your photo…',
    )
    // Zero is not a number to show a client.
    expect(consultAnalysisRunProgress(run({ photoCount: 0 })).headline).toBe(
      'Reading your photos…',
    )
  })

  it('walks the three stages the client was promised, in order', () => {
    expect(
      consultAnalysisRunProgress(run({ stage: 'UNDERSTANDING_REFERENCE' }))
        .headline,
    ).toBe('Understanding your reference…')
    expect(
      consultAnalysisRunProgress(run({ stage: 'BUILDING_PLAN' })).headline,
    ).toBe('Building your plan…')
  })

  it('never moves the bar backwards as the run advances', () => {
    // A bar that jumps back reads as broken. The stages are ordered, so their
    // fractions must be too — asserted over the real sequence rather than
    // spot-checked, so adding a stage in the middle cannot break the order
    // silently.
    const order = [
      'QUEUED',
      'READING_PHOTOS',
      'UNDERSTANDING_REFERENCE',
      'BUILDING_PLAN',
      'FINALIZING',
      'DONE',
    ] as const
    const fractions = order.map(
      (stage) => consultAnalysisRunProgress(run({ stage })).fraction,
    )
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
    expect(fractions.at(0)).toBeGreaterThan(0)
    expect(fractions.at(-1)).toBe(1)
  })

  it('offers the way out on a failed run, and says the work is not lost', () => {
    const failed = consultAnalysisRunProgress(
      run({ status: 'FAILED', stage: 'BUILDING_PLAN', retryable: true }),
    )
    expect(failed.headline).toBe('We couldn’t finish your plan.')
    expect(failed.detail).toContain('try again')
    // 🔴 No failure code, no provider name, no error text. The client is told
    // what happened and what to do, and nothing about our internals.
    expect(`${failed.headline} ${failed.detail}`).not.toMatch(
      /ANALYSIS_|anthropic|provider|P2028/i,
    )
  })

  it('counts only QUEUED and RUNNING as still worth polling', () => {
    expect(isConsultAnalysisRunLive(run({ status: 'QUEUED' }))).toBe(true)
    expect(isConsultAnalysisRunLive(run({ status: 'RUNNING' }))).toBe(true)
    expect(isConsultAnalysisRunLive(run({ status: 'COMPLETED' }))).toBe(false)
    expect(isConsultAnalysisRunLive(run({ status: 'FAILED' }))).toBe(false)
  })
})
