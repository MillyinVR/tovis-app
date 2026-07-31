import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { ClientConsentKind } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  collectBookingConsentRequirements,
  deriveConsentRequirementBadge,
  parseConsentRequirementBadgeWire,
  type ConsentRequirement,
} from './requirement'

const NOW = new Date('2026-08-01T12:00:00.000Z')
const FUTURE = new Date('2026-08-02T12:00:00.000Z')
const PAST = new Date('2026-07-30T12:00:00.000Z')

function requirement(overrides: Partial<ConsentRequirement> = {}): ConsentRequirement {
  return {
    formId: 'form-colour',
    kind: ClientConsentKind.SERVICE_WAIVER,
    title: 'Corrective colour waiver',
    isActive: true,
    currentVersionId: 'v2',
    ...overrides,
  }
}

describe('collectBookingConsentRequirements', () => {
  it('collects from the booking service AND every item — not just one', () => {
    // The colour channel must pick ONE swatch; a warning must name them all.
    const byServiceId = new Map<string, ConsentRequirement>([
      ['svc-colour', requirement({ formId: 'form-colour' })],
      ['svc-lash', requirement({ formId: 'form-lash', title: 'Lash waiver' })],
    ])

    const found = collectBookingConsentRequirements(
      {
        serviceId: 'svc-colour',
        serviceItems: [{ serviceId: 'svc-lash' }],
      },
      byServiceId,
    )

    expect(found.map((r) => r.formId)).toEqual(['form-colour', 'form-lash'])
  })

  it('dedupes by FORM: two services sharing one waiver is one signature', () => {
    const shared = requirement({ formId: 'form-shared' })
    const byServiceId = new Map<string, ConsentRequirement>([
      ['svc-a', shared],
      ['svc-b', shared],
    ])

    const found = collectBookingConsentRequirements(
      { serviceId: 'svc-a', serviceItems: [{ serviceId: 'svc-b' }] },
      byServiceId,
    )

    expect(found).toHaveLength(1)
  })

  it('returns nothing when no service in the booking carries a requirement', () => {
    expect(
      collectBookingConsentRequirements(
        { serviceId: 'svc-none', serviceItems: [{ serviceId: 'svc-other' }] },
        new Map([['svc-colour', requirement()]]),
      ),
    ).toEqual([])
  })
})

describe('deriveConsentRequirementBadge', () => {
  it('is null when everything is signed — absence is the honest display', () => {
    expect(
      deriveConsentRequirementBadge({
        unsigned: [],
        finishedAt: null,
        scheduledFor: FUTURE,
        now: NOW,
      }),
    ).toBeNull()
  })

  it('names the single outstanding form in the description', () => {
    const badge = deriveConsentRequirementBadge({
      unsigned: [requirement()],
      finishedAt: null,
      scheduledFor: FUTURE,
      now: NOW,
    })

    expect(badge?.label).toBe('Form due')
    expect(badge?.description).toBe('Corrective colour waiver not signed')
    expect(badge?.tone).toBe('warn')
    expect(badge?.significant).toBe(true)
  })

  it('counts them when there are several', () => {
    const badge = deriveConsentRequirementBadge({
      unsigned: [requirement(), requirement({ formId: 'b', title: 'Lash' })],
      finishedAt: null,
      scheduledFor: FUTURE,
      now: NOW,
    })

    expect(badge?.description).toBe('2 consent forms not signed')
  })

  it('falls back to neutral words when a form has no title', () => {
    const badge = deriveConsentRequirementBadge({
      unsigned: [requirement({ title: '   ' })],
      finishedAt: null,
      scheduledFor: FUTURE,
      now: NOW,
    })

    expect(badge?.description).toBe('Consent form not signed')
  })

  it('🔴 is NOT significant once the appointment has started', () => {
    // A pro setting their first requirement must not light up every past
    // appointment in amber — those are warnings nobody can act on.
    const badge = deriveConsentRequirementBadge({
      unsigned: [requirement()],
      finishedAt: null,
      scheduledFor: PAST,
      now: NOW,
    })

    expect(badge?.significant).toBe(false)
  })

  it('🔴 is NOT significant once the appointment is finished', () => {
    const badge = deriveConsentRequirementBadge({
      unsigned: [requirement()],
      finishedAt: PAST,
      scheduledFor: FUTURE,
      now: NOW,
    })

    expect(badge?.significant).toBe(false)
  })
})

describe('parseConsentRequirementBadgeWire', () => {
  it('rebuilds label and tone from the table, never from the payload', () => {
    const badge = parseConsentRequirementBadgeWire({
      kind: 'UNSIGNED_CONSENT',
      label: 'PWNED',
      tone: 'success',
      description: 'Corrective colour waiver not signed',
      significant: true,
    })

    expect(badge?.label).toBe('Form due')
    expect(badge?.tone).toBe('warn')
    // The description is the one field the server alone can know — it names the
    // pro's own form — so it IS taken from the wire.
    expect(badge?.description).toBe('Corrective colour waiver not signed')
  })

  it('returns null for anything that is not this badge', () => {
    expect(parseConsentRequirementBadgeWire(undefined)).toBeNull()
    expect(parseConsentRequirementBadgeWire(null)).toBeNull()
    expect(parseConsentRequirementBadgeWire('UNSIGNED_CONSENT')).toBeNull()
    expect(parseConsentRequirementBadgeWire({ kind: 'SOMETHING_ELSE' })).toBeNull()
  })

  it('supplies neutral words when the description is missing or blank', () => {
    expect(
      parseConsentRequirementBadgeWire({
        kind: 'UNSIGNED_CONSENT',
        significant: true,
      })?.description,
    ).toBe('Consent form not signed')
  })

  it('treats a non-true significant as false rather than truthy-coercing it', () => {
    expect(
      parseConsentRequirementBadgeWire({
        kind: 'UNSIGNED_CONSENT',
        significant: 'yes',
      })?.significant,
    ).toBe(false)
  })
})

describe('🔴 the requirement WARNS — it does not BLOCK', () => {
  // The card's v1 rule, and the thing most likely to be quietly violated by a
  // later change: someone adds a "helpful" refusal to the booking path. This
  // pins it structurally, because no runtime test of a path that does nothing
  // can fail when the path starts doing something.
  it('no file under lib/booking/ reads consentFormId', () => {
    const hits = filesContaining(join(process.cwd(), 'lib', 'booking'), 'consentFormId')
    expect(hits).toEqual([])
  })

  it('no file under lib/availability/ reads consentFormId', () => {
    const dir = join(process.cwd(), 'lib', 'availability')
    const hits = safeFilesContaining(dir, 'consentFormId')
    expect(hits).toEqual([])
  })
})

function safeFilesContaining(dir: string, needle: string): string[] {
  try {
    statSync(dir)
  } catch {
    return []
  }
  return filesContaining(dir, needle)
}

function filesContaining(dir: string, needle: string): string[] {
  const out: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      out.push(...filesContaining(full, needle))
      continue
    }

    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      continue
    }

    if (readFileSync(full, 'utf8').includes(needle)) out.push(full)
  }

  return out
}
