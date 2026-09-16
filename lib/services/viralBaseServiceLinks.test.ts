// The three rules a viral name's base-service links must obey, and the diff.
//
// Tested through `planViralBaseServiceLinks` rather than the Prisma call, so the
// rules are covered by the default unit suite instead of only by an integration
// run against a live Postgres. They are the substance of the module: each one
// exists because the alternative is a look that names work nobody can identify.
import { describe, expect, it } from 'vitest'

import {
  VIRAL_BASE_SERVICE_IDS_FIELD,
  ViralBaseServiceChainError,
  ViralBaseServiceEmptyError,
  ViralBaseServiceSelfLinkError,
  parseViralBaseServiceIds,
  planViralBaseServiceLinks,
} from './viralBaseServiceLinks'

const VIRAL = 'svc_wolf_cut'

function plan(over: {
  baseServiceIds: readonly string[]
  existingBaseServiceIds?: readonly string[]
  chainedBaseServiceIds?: readonly string[]
}) {
  return planViralBaseServiceLinks({
    viralServiceId: VIRAL,
    existingBaseServiceIds: [],
    chainedBaseServiceIds: [],
    ...over,
  })
}

describe('parseViralBaseServiceIds', () => {
  it('is null when the field is absent, so an unrelated save cannot wipe links', () => {
    // The distinction that matters: absent means "leave these alone". A form
    // that does not know about base services must not clear them by saving.
    expect(parseViralBaseServiceIds(new FormData())).toBeNull()
  })

  it('reads a present-but-blank field as an EMPTY set, not as absent', () => {
    // Empty is a real answer — and one `planViralBaseServiceLinks` then refuses.
    // Collapsing it into null here would turn "clear these" into "ignore me".
    const form = new FormData()
    form.set(VIRAL_BASE_SERVICE_IDS_FIELD, '')
    expect(parseViralBaseServiceIds(form)).toEqual([])
  })

  it('accepts repeated and comma-joined values, trimmed and de-duplicated', () => {
    const form = new FormData()
    form.append(VIRAL_BASE_SERVICE_IDS_FIELD, ' svc_a , svc_b')
    form.append(VIRAL_BASE_SERVICE_IDS_FIELD, 'svc_b')
    expect(parseViralBaseServiceIds(form)).toEqual(['svc_a', 'svc_b'])
  })
})

describe('rule 1 — at least one base service', () => {
  it('refuses an empty set', () => {
    // Tori, 2026-09-15: "a viral service should always be connected to at least
    // one if not more other services." A viral name with nothing underneath it
    // names no work, and slice 5's prompt would have nothing to fire on.
    expect(() => plan({ baseServiceIds: [] })).toThrow(ViralBaseServiceEmptyError)
  })

  it('refuses emptying a set that currently HAS links', () => {
    expect(() =>
      plan({ baseServiceIds: [], existingBaseServiceIds: ['svc_haircut'] }),
    ).toThrow(ViralBaseServiceEmptyError)
  })
})

describe('rule 2 — never itself', () => {
  it('refuses a service linked as its own base service', () => {
    expect(() => plan({ baseServiceIds: [VIRAL] })).toThrow(
      ViralBaseServiceSelfLinkError,
    )
  })

  it('refuses it even alongside legitimate links', () => {
    expect(() => plan({ baseServiceIds: ['svc_haircut', VIRAL] })).toThrow(
      ViralBaseServiceSelfLinkError,
    )
  })
})

describe('rule 3 — no chains', () => {
  it('refuses a base service that is itself a viral name', () => {
    // Two levels, exactly: the trending name and the real service. A chain would
    // make "removing ANY linked base service" (slice 5) depend on how far you
    // follow it, and nobody has decided that.
    expect(() =>
      plan({
        baseServiceIds: ['svc_shag'],
        chainedBaseServiceIds: ['svc_shag'],
      }),
    ).toThrow(ViralBaseServiceChainError)
  })

  it('names the offending ids so the admin can fix the selection', () => {
    try {
      plan({
        baseServiceIds: ['svc_haircut', 'svc_shag'],
        chainedBaseServiceIds: ['svc_shag'],
      })
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(ViralBaseServiceChainError)
      expect((error as ViralBaseServiceChainError).chainedServiceIds).toEqual([
        'svc_shag',
      ])
      expect((error as Error).message).toContain('svc_shag')
    }
  })

  it('ignores a chained service that is being REMOVED, not added', () => {
    // Otherwise a set that went bad could never be corrected: the write that
    // takes the chained link OUT would be refused because of the link it is
    // removing.
    expect(
      plan({
        baseServiceIds: ['svc_haircut'],
        existingBaseServiceIds: ['svc_haircut', 'svc_shag'],
        chainedBaseServiceIds: ['svc_shag'],
      }),
    ).toEqual({ toAdd: [], toRemove: ['svc_shag'] })
  })
})

describe('the diff', () => {
  it('adds what is missing and removes what is not wanted', () => {
    expect(
      plan({
        baseServiceIds: ['svc_haircut', 'svc_style'],
        existingBaseServiceIds: ['svc_haircut', 'svc_colour'],
      }),
    ).toEqual({ toAdd: ['svc_style'], toRemove: ['svc_colour'] })
  })

  it('touches nothing when the set is unchanged', () => {
    // An idempotent save must not churn rows — `createdAt` is when the admin
    // FIRST said this look was a haircut, and a no-op re-save that deleted and
    // re-inserted would quietly reset it.
    expect(
      plan({
        baseServiceIds: ['svc_haircut'],
        existingBaseServiceIds: ['svc_haircut'],
      }),
    ).toEqual({ toAdd: [], toRemove: [] })
  })

  it('is insensitive to order and to duplicates in the request', () => {
    expect(
      plan({
        baseServiceIds: ['svc_style', 'svc_haircut', 'svc_style'],
        existingBaseServiceIds: ['svc_haircut', 'svc_style'],
      }),
    ).toEqual({ toAdd: [], toRemove: [] })
  })
})
