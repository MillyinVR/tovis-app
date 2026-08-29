// lib/migration/serviceImportServer.test.ts
//
// W6 for the CSV service-menu import.
//
// The import used to have no capability derivation at ALL: an absent mode flag
// parsed as `false`, so both clients hardcoded `offersInSalon: true` /
// `offersMobile: false` rather than trip the NO_MODE refusal — and a mobile-only
// pro's entire imported menu was written salon-only. These tests pin the fixed
// contract: unstated ⇒ derived from `loadProLocationCapability`, stated ⇒
// obeyed verbatim (and not even paid for with a query).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ProfessionalLocationType } from '@prisma/client'

const locationFindMany = vi.fn()
const writeOfferingMock = vi.fn()
const loadAllowedServicesMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalLocation: {
      findMany: (...args: unknown[]) => locationFindMany(...args),
    },
    // The commit runs each row in its own transaction; the callback only ever
    // touches `offeringPriceRamp`, which writeOffering is mocked out of.
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        offeringPriceRamp: { upsert: vi.fn().mockResolvedValue({}) },
      }),
  },
}))

vi.mock('@/lib/offerings/writeOffering', () => ({
  OfferingAlreadyActiveError: class OfferingAlreadyActiveError extends Error {},
  writeOffering: (...args: unknown[]) => writeOfferingMock(...args),
}))

vi.mock('@/lib/services/allowedServices', () => ({
  loadAllowedServices: (...args: unknown[]) => loadAllowedServicesMock(...args),
}))

import {
  commitServiceImport,
  parseServiceDecisions,
  previewServiceImport,
  type ServiceImportDecision,
} from './serviceImportServer'

const SALON_ONLY = [{ type: ProfessionalLocationType.SALON }]
const MOBILE_ONLY = [{ type: ProfessionalLocationType.MOBILE_BASE }]
const NO_LOCATION: Array<{ type: ProfessionalLocationType }> = []

const CATALOG = [
  {
    id: 'svc_cut',
    name: 'Silk Press',
    description: null,
    categoryName: 'Hair',
    categoryDescription: null,
    defaultDurationMinutes: 90,
    minPrice: '80.00',
    allowMobile: true,
  },
]

/** One decision with every mode flag left unstated — what both clients now send. */
function unstated(over: Partial<ServiceImportDecision> = {}): ServiceImportDecision {
  return {
    serviceId: 'svc_cut',
    offersInSalon: null,
    offersMobile: null,
    // A CSV row carries one price/duration with no mode attached, so the
    // clients send it for BOTH modes and the server keeps the one it derives.
    salonPrice: 120,
    salonDurationMinutes: 90,
    mobilePrice: 120,
    mobileDurationMinutes: 90,
    ramp: { stepMode: 'PCT', stepValue: 10, cadenceWeeks: 10 },
    ...over,
  }
}

/** The offering fields writeOffering was actually asked to persist. */
function writtenModes() {
  const call = writeOfferingMock.mock.calls[0]?.[0]
  return {
    offersInSalon: call?.offersInSalon,
    offersMobile: call?.offersMobile,
    salonPrice: call?.salonPrice === null ? null : Number(call?.salonPrice),
    mobilePrice: call?.mobilePrice === null ? null : Number(call?.mobilePrice),
  }
}

beforeEach(() => {
  locationFindMany.mockReset()
  writeOfferingMock.mockReset()
  loadAllowedServicesMock.mockReset()
  loadAllowedServicesMock.mockResolvedValue(CATALOG)
  writeOfferingMock.mockResolvedValue({ id: 'off_1' })
})

// ── the parser: absent is not false ──────────────────────────────────────────

describe('parseServiceDecisions', () => {
  const base = { serviceId: 'svc_cut', ramp: {} }

  it('reports an ABSENT mode flag as unstated, not false', () => {
    const parsed = parseServiceDecisions({ decisions: [base] })
    expect(parsed?.[0]?.offersInSalon).toBeNull()
    expect(parsed?.[0]?.offersMobile).toBeNull()
  })

  it('keeps a STATED false as false — a choice, not an omission', () => {
    const parsed = parseServiceDecisions({
      decisions: [{ ...base, offersInSalon: false, offersMobile: true }],
    })
    expect(parsed?.[0]?.offersInSalon).toBe(false)
    expect(parsed?.[0]?.offersMobile).toBe(true)
  })

  it('degrades a present-but-non-boolean flag to unstated', () => {
    const parsed = parseServiceDecisions({
      decisions: [{ ...base, offersInSalon: 'yes', offersMobile: 1 }],
    })
    expect(parsed?.[0]?.offersInSalon).toBeNull()
    expect(parsed?.[0]?.offersMobile).toBeNull()
  })
})

// ── the preview: something for the clients to seed from ──────────────────────

describe('previewServiceImport', () => {
  it('carries the pro capability and the derived mode pair', async () => {
    locationFindMany.mockResolvedValue(MOBILE_ONLY)

    const preview = await previewServiceImport({
      professionalId: 'pro_1',
      rows: [{ name: 'Silk Press', price: 120, durationMinutes: 90 }],
    })

    expect(preview.locationCapability).toEqual({ salon: false, mobile: true })
    expect(preview.defaultOfferingModes).toEqual({
      offersInSalon: false,
      offersMobile: true,
    })
  })
})

// ── the commit: the bug this whole change exists for ─────────────────────────

describe('commitServiceImport mode derivation', () => {
  it('gives a MOBILE-ONLY pro mobile services, not NO_MODE', async () => {
    locationFindMany.mockResolvedValue(MOBILE_ONLY)

    const result = await commitServiceImport({
      professionalId: 'pro_1',
      decisions: [unstated()],
    })

    expect(result.summary).toMatchObject({ created: 1, skipped: 0 })
    expect(result.rows[0]).toMatchObject({ ok: true })
    // Before the fix this row was written salon-only; unstated + no derivation
    // would instead have been refused outright.
    expect(writtenModes()).toEqual({
      offersInSalon: false,
      offersMobile: true,
      salonPrice: null,
      mobilePrice: 120,
    })
  })

  it('leaves a SALON-capable pro exactly as before (regression guard)', async () => {
    locationFindMany.mockResolvedValue(SALON_ONLY)

    const result = await commitServiceImport({
      professionalId: 'pro_1',
      decisions: [unstated()],
    })

    expect(result.summary).toMatchObject({ created: 1, skipped: 0 })
    expect(writtenModes()).toEqual({
      offersInSalon: true,
      offersMobile: false,
      salonPrice: 120,
      mobilePrice: null,
    })
  })

  it('falls back to salon for a pro with NO bookable location', async () => {
    locationFindMany.mockResolvedValue(NO_LOCATION)

    const result = await commitServiceImport({
      professionalId: 'pro_1',
      decisions: [unstated()],
    })

    // The legacy `true`: never a refusal, and the read boundary takes an
    // unhostable mode back off before any client sees it.
    expect(result.summary).toMatchObject({ created: 1, skipped: 0 })
    expect(writtenModes()).toMatchObject({ offersInSalon: true, offersMobile: false })
  })

  it('obeys STATED flags and never queries capability for them', async () => {
    const result = await commitServiceImport({
      professionalId: 'pro_1',
      decisions: [unstated({ offersInSalon: true, offersMobile: false })],
    })

    expect(result.summary).toMatchObject({ created: 1 })
    expect(locationFindMany).not.toHaveBeenCalled()
    expect(writtenModes()).toMatchObject({ offersInSalon: true, offersMobile: false })
  })

  it('still refuses a row that states BOTH modes off', async () => {
    const result = await commitServiceImport({
      professionalId: 'pro_1',
      decisions: [unstated({ offersInSalon: false, offersMobile: false })],
    })

    expect(result.rows[0]).toMatchObject({ ok: false, code: 'NO_MODE' })
    expect(result.summary).toMatchObject({ created: 0, skipped: 1, attempted: 0 })
    expect(writeOfferingMock).not.toHaveBeenCalled()
  })

  it('derives ONCE per commit, not once per row', async () => {
    locationFindMany.mockResolvedValue(MOBILE_ONLY)

    await commitServiceImport({
      professionalId: 'pro_1',
      decisions: [unstated(), unstated(), unstated()],
    })

    expect(locationFindMany).toHaveBeenCalledTimes(1)
    expect(writeOfferingMock).toHaveBeenCalledTimes(3)
  })

  it('ramps the DERIVED mobile mode when the pro price is below the floor', async () => {
    locationFindMany.mockResolvedValue(MOBILE_ONLY)

    const result = await commitServiceImport({
      professionalId: 'pro_1',
      // Catalog floor is 80; 60 is below it, so the mobile mode gets the ramp
      // and the offering stores the floor.
      decisions: [unstated({ salonPrice: 60, mobilePrice: 60 })],
    })

    expect(result.summary.rampsCreated).toBe(1)
    const call = writeOfferingMock.mock.calls[0]?.[0]
    expect(call.mobilePrice).toBeInstanceOf(Prisma.Decimal)
    expect(Number(call.mobilePrice)).toBe(80)
    expect(call.salonPrice).toBeNull()
  })
})
