// lib/notifications/stalledConsultNudge.test.ts
//
// Pure-core coverage for the unfinished-consult trigger: the two rules that
// decide who may be nudged at all (next move is HERS, and the consult can still
// be added to), the idle window, one-per-client selection, per-client budget
// allocation, the cooldown-bucketed dedupeKey — and the copy contract, whose
// whole job is to be honest about the photo she can no longer use.

import { ConsultSessionStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  STALLED_CONSULT,
  STALLED_CONSULT_TRIGGER,
  allocateStalledConsultNudges,
  buildStalledConsultDedupeKey,
  composeStalledConsultCopy,
  resolveStalledConsultPhotoState,
  selectStalledConsultCandidates,
  type StalledConsultCandidate,
  type StalledConsultRow,
} from './stalledConsultNudge'

const NOW = new Date('2026-09-13T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS)
}

function session(overrides: Partial<StalledConsultRow> = {}): StalledConsultRow {
  return {
    consultSessionId: 'consult-1',
    clientId: 'client-1',
    professionalId: 'pro-1',
    status: ConsultSessionStatus.MEDIA_READY,
    idleSince: daysAgo(10),
    liveCaptures: 0,
    everCaptures: 1,
    inputOpen: true,
    ...overrides,
  }
}

function select(
  sessions: StalledConsultRow[],
  alreadyNotified: string[] = [],
): StalledConsultCandidate[] {
  return selectStalledConsultCandidates({
    sessions,
    alreadyNotifiedDedupeKeys: new Set(alreadyNotified),
    now: NOW,
  })
}

describe('buildStalledConsultDedupeKey', () => {
  it('is stable inside a cooldown window and rolls to a new bucket after it', () => {
    // Buckets are floor(epochMs / cooldown) — aligned to the epoch, not to NOW —
    // so build times relative to the bucket start to test this deterministically.
    const cooldownMs = STALLED_CONSULT.cooldownDays * DAY_MS
    const bucketStart = Math.floor(NOW.getTime() / cooldownMs) * cooldownMs
    const early = new Date(bucketStart + 1_000)
    const late = new Date(bucketStart + cooldownMs - 1_000)
    const next = new Date(bucketStart + cooldownMs + 1_000)

    const key = (now: Date) =>
      buildStalledConsultDedupeKey({ consultSessionId: 'consult-1', now })

    expect(key(early)).toBe(key(late))
    expect(key(next)).not.toBe(key(early))
  })

  it('is keyed to the CONSULT, so two half-finished consults never share one', () => {
    expect(
      buildStalledConsultDedupeKey({ consultSessionId: 'a', now: NOW }),
    ).not.toBe(buildStalledConsultDedupeKey({ consultSessionId: 'b', now: NOW }))
  })
})

describe('🔴 who may be nudged', () => {
  it('never nudges a consult waiting on the SYSTEM, whatever its age', () => {
    // The rule that matters most. ANALYSIS_PENDING is our queue and ANALYZING is
    // our run — on 2026-09-11 one real client burned four analysis runs, each
    // exhausting its attempts, and got nothing. Reminding her to "finish" that
    // would be blaming her for our bug.
    expect(
      select([
        session({ status: ConsultSessionStatus.ANALYSIS_PENDING }),
        session({
          consultSessionId: 'consult-2',
          status: ConsultSessionStatus.ANALYZING,
        }),
      ]),
    ).toEqual([])
  })

  it('never nudges a consult that can no longer be added to', () => {
    // `inputOpen` carries `resolveConsultInputWindow` — the appointment has
    // started, or the booking left the pilot window. The link would open a page
    // that refuses her, which is worse than saying nothing.
    expect(select([session({ inputOpen: false })])).toEqual([])
  })

  it('nudges every status whose next move is hers', () => {
    const statuses = [
      ConsultSessionStatus.CONSENT_REQUIRED,
      ConsultSessionStatus.EARLY_PHOTO_READY,
      ConsultSessionStatus.INTAKE_READY,
      ConsultSessionStatus.INTAKE_IN_PROGRESS,
      ConsultSessionStatus.MEDIA_READY,
    ]
    for (const status of statuses) {
      expect(select([session({ status })]).map((c) => c.status)).toEqual([status])
    }
  })
})

describe('the idle window', () => {
  it('leaves a consult she touched recently alone', () => {
    expect(select([session({ idleSince: daysAgo(1) })])).toEqual([])
    expect(
      select([session({ idleSince: daysAgo(STALLED_CONSULT.minIdleDays + 1) })]),
    ).toHaveLength(1)
  })

  it('stops chasing once intent has gone stale', () => {
    expect(
      select([session({ idleSince: daysAgo(STALLED_CONSULT.maxIdleDays + 1) })]),
    ).toEqual([])
  })
})

describe('one reminder, not a campaign', () => {
  it('keeps only the most recently touched consult per client', () => {
    const candidates = select([
      session({ consultSessionId: 'older', idleSince: daysAgo(20) }),
      session({ consultSessionId: 'newer', idleSince: daysAgo(5) }),
    ])
    expect(candidates.map((c) => c.consultSessionId)).toEqual(['newer'])
  })

  it('skips a consult already nudged this cooldown window', () => {
    const key = buildStalledConsultDedupeKey({
      consultSessionId: 'consult-1',
      now: NOW,
    })
    expect(select([session()], [key])).toEqual([])
  })

  it('still nudges a DIFFERENT client in the same run', () => {
    const candidates = select([
      session(),
      session({ consultSessionId: 'consult-2', clientId: 'client-2' }),
    ])
    expect(candidates.map((c) => c.clientId).sort()).toEqual([
      'client-1',
      'client-2',
    ])
  })
})

describe('resolveStalledConsultPhotoState', () => {
  it('reads RESUME, RETAKE and START off the capture counts', () => {
    expect(
      resolveStalledConsultPhotoState({ liveCaptures: 1, everCaptures: 3 }),
    ).toBe('RESUME')
    expect(
      resolveStalledConsultPhotoState({ liveCaptures: 0, everCaptures: 3 }),
    ).toBe('RETAKE')
    expect(
      resolveStalledConsultPhotoState({ liveCaptures: 0, everCaptures: 0 }),
    ).toBe('START')
  })
})

describe('🔴 the copy is honest about the photo', () => {
  const copyFor = (photoState: StalledConsultCandidate['photoState']) =>
    composeStalledConsultCopy({
      proName: 'Ada',
      candidate: {
        consultSessionId: 'consult-1',
        professionalId: 'pro-1',
        status: ConsultSessionStatus.MEDIA_READY,
        photoState,
      },
    })

  it('says a fresh photo is needed when hers have expired', () => {
    // The trap this trigger had to be designed around: raw captures expire on a
    // ~1h TTL and the analysis loader refuses anything past it, so "pick up
    // where you left off" would be an invitation to a refusal.
    expect(copyFor('RETAKE').body).toContain('expired')
    expect(copyFor('RETAKE').body).toContain('fresh one')
  })

  it('does NOT mention expiry when her photos are still usable', () => {
    expect(copyFor('RESUME').body).not.toContain('expired')
    expect(copyFor('RESUME').body).toContain('still there')
  })

  it('does NOT mention photos at all when she never took one', () => {
    expect(copyFor('START').body).not.toContain('photo')
  })

  it('never pressures, and points at her own consult', () => {
    for (const state of ['RESUME', 'RETAKE', 'START'] as const) {
      const copy = copyFor(state)
      expect(copy.href).toBe('/client/consult/consult-1')
      expect(copy.body.toLowerCase()).not.toMatch(/hurry|last chance|expires soon|act now/)
      expect(copy.data.trigger).toBe(STALLED_CONSULT_TRIGGER)
      expect(copy.data.photoState).toBe(state)
    }
  })

  it('falls back to a neutral name rather than an empty one', () => {
    const copy = composeStalledConsultCopy({
      proName: '   ',
      candidate: {
        consultSessionId: 'consult-1',
        professionalId: 'pro-1',
        status: ConsultSessionStatus.MEDIA_READY,
        photoState: 'START',
      },
    })
    expect(copy.title).toBe('Want to finish your consult with your pro?')
  })
})

describe('allocateStalledConsultNudges', () => {
  const candidate = (
    overrides: Partial<StalledConsultCandidate> = {},
  ): StalledConsultCandidate => ({
    clientId: 'client-1',
    professionalId: 'pro-1',
    consultSessionId: 'consult-1',
    status: ConsultSessionStatus.MEDIA_READY,
    idleSince: daysAgo(10),
    photoState: 'RETAKE',
    dedupeKey: 'stalled-consult:consult-1:0',
    trigger: STALLED_CONSULT_TRIGGER,
    ...overrides,
  })

  it('drops a muted client before spending any budget', () => {
    const result = allocateStalledConsultNudges({
      candidates: [candidate()],
      sentCountByClient: new Map(),
      mutedClients: new Set(['client-1']),
    })
    expect(result.granted).toEqual([])
    expect(result.mutedOptOut).toBe(1)
    expect(result.budgetBlocked).toBe(0)
  })

  it('yields to a client already at her pooled weekly cap', () => {
    const result = allocateStalledConsultNudges({
      candidates: [candidate()],
      sentCountByClient: new Map([['client-1', 99]]),
      mutedClients: new Set(),
    })
    expect(result.granted).toEqual([])
    expect(result.budgetBlocked).toBe(1)
  })

  it('sends when there is room', () => {
    const result = allocateStalledConsultNudges({
      candidates: [candidate()],
      sentCountByClient: new Map(),
      mutedClients: new Set(),
    })
    expect(result.granted.map((c) => c.consultSessionId)).toEqual(['consult-1'])
  })
})
