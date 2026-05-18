// lib/booking/aftercareRebookSlotOwnership.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfessionalLocationType, ServiceLocationType } from '@prisma/client'
import {
  validateAftercareRebookSlotOwnership,
  type AftercareRebookSlotOwnershipReader,
} from './aftercareRebookSlotOwnership'

const mocks = vi.hoisted(() => ({
  professionalLocationFindFirst: vi.fn(),
  professionalServiceOfferingFindFirst: vi.fn(),
}))

const db: AftercareRebookSlotOwnershipReader = {
  professionalLocation: {
    findFirst: mocks.professionalLocationFindFirst,
  },
  professionalServiceOffering: {
    findFirst: mocks.professionalServiceOfferingFindFirst,
  },
}

function makeSlot(overrides?: {
  professionalId?: string
  locationId?: string
  locationType?: ServiceLocationType
  offeringId?: string | null
}) {
  return {
    professionalId: overrides?.professionalId ?? 'pro_1',
    locationId: overrides?.locationId ?? 'location_1',
    locationType: overrides?.locationType ?? ServiceLocationType.SALON,
    offeringId:
      overrides && 'offeringId' in overrides
        ? overrides.offeringId ?? null
        : 'offering_1',
  }
}

function makeLocation(overrides?: {
  id?: string
  professionalId?: string
  isBookable?: boolean
  type?: ProfessionalLocationType
}) {
  return {
    id: overrides?.id ?? 'location_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    isBookable: overrides?.isBookable ?? true,
    type: overrides?.type ?? ProfessionalLocationType.SALON,
  }
}

function makeOffering(overrides?: {
  id?: string
  professionalId?: string
  isActive?: boolean
  offersInSalon?: boolean
  offersMobile?: boolean
}) {
  return {
    id: overrides?.id ?? 'offering_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    isActive: overrides?.isActive ?? true,
    offersInSalon: overrides?.offersInSalon ?? true,
    offersMobile: overrides?.offersMobile ?? true,
  }
}

describe('validateAftercareRebookSlotOwnership', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mocks.professionalLocationFindFirst.mockResolvedValue(makeLocation())
    mocks.professionalServiceOfferingFindFirst.mockResolvedValue(makeOffering())
  })

  it('allows a valid salon slot with an owned active offering', async () => {
    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          locationType: ServiceLocationType.SALON,
        }),
      }),
    ).resolves.toEqual({ ok: true })

    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'location_1',
        professionalId: 'pro_1',
      },
      select: {
        id: true,
        professionalId: true,
        isBookable: true,
        type: true,
      },
    })

    expect(mocks.professionalServiceOfferingFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'offering_1',
        professionalId: 'pro_1',
      },
      select: {
        id: true,
        professionalId: true,
        isActive: true,
        offersInSalon: true,
        offersMobile: true,
      },
    })
  })

  it('allows a valid mobile slot with an owned active offering', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(
      makeLocation({
        type: ProfessionalLocationType.MOBILE_BASE,
      }),
    )

    mocks.professionalServiceOfferingFindFirst.mockResolvedValueOnce(
      makeOffering({
        offersInSalon: false,
        offersMobile: true,
      }),
    )

    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          locationType: ServiceLocationType.MOBILE,
        }),
      }),
    ).resolves.toEqual({ ok: true })
  })

  it('allows a slot without an offering because aftercare rebook offerings are optional', async () => {
    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          offeringId: null,
        }),
      }),
    ).resolves.toEqual({ ok: true })

    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'location_1',
        professionalId: 'pro_1',
      },
      select: {
        id: true,
        professionalId: true,
        isBookable: true,
        type: true,
      },
    })

    expect(mocks.professionalServiceOfferingFindFirst).not.toHaveBeenCalled()
  })

  it('trims ids before querying ownership', async () => {
    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          professionalId: '  pro_1  ',
          locationId: '  location_1  ',
          offeringId: '  offering_1  ',
        }),
      }),
    ).resolves.toEqual({ ok: true })

    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'location_1',
          professionalId: 'pro_1',
        },
      }),
    )

    expect(mocks.professionalServiceOfferingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'offering_1',
          professionalId: 'pro_1',
        },
      }),
    )
  })

  it('rejects a missing professional id', async () => {
    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          professionalId: '   ',
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'PROFESSIONAL_REQUIRED',
      userMessage:
        'This aftercare rebook slot is missing professional ownership.',
    })

    expect(mocks.professionalLocationFindFirst).not.toHaveBeenCalled()
    expect(mocks.professionalServiceOfferingFindFirst).not.toHaveBeenCalled()
  })

  it('rejects a missing location id', async () => {
    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          locationId: '   ',
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'LOCATION_REQUIRED',
      userMessage: 'Choose a valid location for the next appointment.',
    })

    expect(mocks.professionalLocationFindFirst).not.toHaveBeenCalled()
    expect(mocks.professionalServiceOfferingFindFirst).not.toHaveBeenCalled()
  })

  it('rejects a location that does not belong to the professional', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(null)

    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot(),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'LOCATION_NOT_FOUND',
      userMessage:
        'That location is no longer available for this professional.',
    })

    expect(mocks.professionalServiceOfferingFindFirst).not.toHaveBeenCalled()
  })

  it('rejects an unbookable location', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(
      makeLocation({
        isBookable: false,
      }),
    )

    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot(),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'LOCATION_NOT_BOOKABLE',
      userMessage: 'That location is not currently bookable.',
    })

    expect(mocks.professionalServiceOfferingFindFirst).not.toHaveBeenCalled()
  })

  it('rejects a salon slot for a mobile base location', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(
      makeLocation({
        type: ProfessionalLocationType.MOBILE_BASE,
      }),
    )

    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          locationType: ServiceLocationType.SALON,
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'LOCATION_TYPE_UNSUPPORTED',
      userMessage: 'That location does not support this appointment type.',
    })

    expect(mocks.professionalServiceOfferingFindFirst).not.toHaveBeenCalled()
  })

  it('rejects a mobile slot for a salon location', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(
      makeLocation({
        type: ProfessionalLocationType.SALON,
      }),
    )

    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          locationType: ServiceLocationType.MOBILE,
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'LOCATION_TYPE_UNSUPPORTED',
      userMessage: 'That location does not support this appointment type.',
    })

    expect(mocks.professionalServiceOfferingFindFirst).not.toHaveBeenCalled()
  })

  it('rejects an offering that does not belong to the professional', async () => {
    mocks.professionalServiceOfferingFindFirst.mockResolvedValueOnce(null)

    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot(),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'OFFERING_NOT_FOUND',
      userMessage:
        'That service is no longer available for this professional.',
    })
  })

  it('rejects an inactive offering', async () => {
    mocks.professionalServiceOfferingFindFirst.mockResolvedValueOnce(
      makeOffering({
        isActive: false,
      }),
    )

    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot(),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'OFFERING_INACTIVE',
      userMessage: 'That service is not currently active.',
    })
  })

  it('rejects a salon slot for a mobile-only offering', async () => {
    mocks.professionalServiceOfferingFindFirst.mockResolvedValueOnce(
      makeOffering({
        offersInSalon: false,
        offersMobile: true,
      }),
    )

    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          locationType: ServiceLocationType.SALON,
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'OFFERING_LOCATION_TYPE_UNSUPPORTED',
      userMessage: 'That service does not support this appointment type.',
    })
  })

  it('rejects a mobile slot for a salon-only offering', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(
      makeLocation({
        type: ProfessionalLocationType.MOBILE_BASE,
      }),
    )

    mocks.professionalServiceOfferingFindFirst.mockResolvedValueOnce(
      makeOffering({
        offersInSalon: true,
        offersMobile: false,
      }),
    )

    await expect(
      validateAftercareRebookSlotOwnership({
        db,
        slot: makeSlot({
          locationType: ServiceLocationType.MOBILE,
        }),
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'OFFERING_LOCATION_TYPE_UNSUPPORTED',
      userMessage: 'That service does not support this appointment type.',
    })
  })
})