// lib/offerings/locationCapability.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfessionalLocationType } from '@prisma/client'

const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalLocation: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}))

import {
  loadProLocationCapabilities,
  loadProLocationCapability,
  narrowOfferingModes,
} from './locationCapability'

beforeEach(() => {
  findMany.mockReset()
})

describe('loadProLocationCapability', () => {
  it('only counts BOOKABLE, non-archived locations', async () => {
    findMany.mockResolvedValue([])

    await loadProLocationCapability('pro_1')

    const where = findMany.mock.calls[0]?.[0]?.where
    // The whole point of W6: the "Set salon address" placeholder is written
    // isBookable:false, and it must not read as a salon the pro can host.
    expect(where).toMatchObject({
      professionalId: 'pro_1',
      archivedAt: null,
      isBookable: true,
    })
  })

  it('reports salon capability from a SALON location', async () => {
    findMany.mockResolvedValue([{ type: ProfessionalLocationType.SALON }])

    await expect(loadProLocationCapability('pro_1')).resolves.toEqual({
      salon: true,
      mobile: false,
    })
  })

  it('reports salon capability from a SUITE location', async () => {
    findMany.mockResolvedValue([{ type: ProfessionalLocationType.SUITE }])

    await expect(loadProLocationCapability('pro_1')).resolves.toEqual({
      salon: true,
      mobile: false,
    })
  })

  it('reports a mobile-only pro as mobile-only', async () => {
    findMany.mockResolvedValue([{ type: ProfessionalLocationType.MOBILE_BASE }])

    await expect(loadProLocationCapability('pro_1')).resolves.toEqual({
      salon: false,
      mobile: true,
    })
  })

  it('reports neither when the pro has no bookable location', async () => {
    findMany.mockResolvedValue([])

    await expect(loadProLocationCapability('pro_1')).resolves.toEqual({
      salon: false,
      mobile: false,
    })
  })
})

describe('narrowOfferingModes', () => {
  // The reported W6 defect, exactly: the founder's offerings all said
  // offersInSalon:true, her only bookable location was MOBILE_BASE, and the
  // booking drawer rendered an In-salon toggle with the salon waitlist under it.
  it('drops a salon claim the pro cannot host', () => {
    expect(
      narrowOfferingModes(
        { offersInSalon: true, offersMobile: true },
        { salon: false, mobile: true },
      ),
    ).toEqual({ offersInSalon: false, offersMobile: true })
  })

  it('drops a mobile claim the pro cannot host', () => {
    expect(
      narrowOfferingModes(
        { offersInSalon: true, offersMobile: true },
        { salon: true, mobile: false },
      ),
    ).toEqual({ offersInSalon: true, offersMobile: false })
  })

  it('never turns a mode ON that the offering did not claim', () => {
    expect(
      narrowOfferingModes(
        { offersInSalon: false, offersMobile: false },
        { salon: true, mobile: true },
      ),
    ).toEqual({ offersInSalon: false, offersMobile: false })
  })

  it('preserves unrelated fields', () => {
    expect(
      narrowOfferingModes(
        { id: 'off_1', offersInSalon: true, offersMobile: false },
        { salon: false, mobile: false },
      ),
    ).toEqual({ id: 'off_1', offersInSalon: false, offersMobile: false })
  })
})

describe('the read boundary is actually wired up', () => {
  // A policy helper nothing calls is a convention, not a gate. `offeringContext`
  // is the one place the client's booking drawer gets an offering's modes from
  // (`summary.offering` -> the `allowed` memo in AvailabilityDrawer), so if this
  // call disappears the In-salon toggle comes straight back for every
  // mobile-only pro — with every unit test above still green.
  it('offeringContext narrows offering modes before publishing them', () => {
    const src = readFileSync(
      join(__dirname, '..', 'availability/data/offeringContext.ts'),
      'utf8',
    )

    // Match the CALL, not the identifier: `toContain('narrowOfferingModes')`
    // stays green against `narrowOfferingModes_DISABLED(...)`, which is exactly
    // the shape a bypass takes.
    expect(src).toMatch(/\bloadProLocationCapability\s*\(/)
    expect(src).toMatch(/\bnarrowOfferingModes\s*\(/)
  })
})

describe('loadProLocationCapabilities', () => {
  it('answers for every requested pro in ONE query, absent pros included', async () => {
    findMany.mockResolvedValue([
      { professionalId: 'pro_salon', type: ProfessionalLocationType.SALON },
      { professionalId: 'pro_both', type: ProfessionalLocationType.SUITE },
      { professionalId: 'pro_both', type: ProfessionalLocationType.MOBILE_BASE },
    ])
    const result = await loadProLocationCapabilities([
      'pro_salon',
      'pro_both',
      'pro_nothing',
    ])
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]?.[0]?.where).toMatchObject({
      professionalId: { in: ['pro_salon', 'pro_both', 'pro_nothing'] },
      archivedAt: null,
      isBookable: true,
    })
    expect(result.get('pro_salon')).toEqual({ salon: true, mobile: false })
    expect(result.get('pro_both')).toEqual({ salon: true, mobile: true })
    // A pro with no bookable location is PRESENT with nothing hostable, so a
    // list surface can narrow every row without a fallback branch.
    expect(result.get('pro_nothing')).toEqual({ salon: false, mobile: false })
  })

  it('skips the query for an empty list', async () => {
    await expect(loadProLocationCapabilities([])).resolves.toEqual(new Map())
    expect(findMany).not.toHaveBeenCalled()
  })
})
