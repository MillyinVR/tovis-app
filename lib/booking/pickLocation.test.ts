import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    professionalLocation: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { pickBookableLocation } from './pickLocation'

function makeLocation(overrides?: {
  id?: string
  type?: ProfessionalLocationType
  isPrimary?: boolean
  isBookable?: boolean
  createdAt?: Date
}) {
  return {
    id: overrides?.id ?? 'loc_primary',
    type: overrides?.type ?? ProfessionalLocationType.SALON,
    name: 'Main Studio',
    isPrimary: overrides?.isPrimary ?? true,
    isBookable: overrides?.isBookable ?? true,
    timeZone: 'America/Los_Angeles',
    workingHours: {
      mon: { enabled: true, start: '09:00', end: '17:00' },
    },
    bufferMinutes: 15,
    stepMinutes: 30,
    advanceNoticeMinutes: 15,
    maxDaysAhead: 365,
    lat: new Prisma.Decimal('32.7157000'),
    lng: new Prisma.Decimal('-117.1611000'),
    city: 'San Diego',
    formattedAddress: '123 Main St',
    createdAt: overrides?.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
  }
}

describe('lib/booking/pickLocation.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the requested compatible bookable location', async () => {
    const mobileBase = makeLocation({
      id: 'loc_mobile',
      type: ProfessionalLocationType.MOBILE_BASE,
      isPrimary: false,
    })

    mocks.prisma.professionalLocation.findFirst.mockResolvedValue(mobileBase)

    const result = await pickBookableLocation({
      professionalId: 'pro_1',
      requestedLocationId: 'loc_mobile',
      locationType: ServiceLocationType.MOBILE,
    })

    expect(mocks.prisma.professionalLocation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'loc_mobile',
        professionalId: 'pro_1',
        isBookable: true,
        type: { in: [ProfessionalLocationType.MOBILE_BASE] },
      },
      select: expect.any(Object),
    })

    expect(result).toEqual(mobileBase)
  })

  it('falls back to the primary compatible location when no location id is requested', async () => {
    const primarySalon = makeLocation({
      id: 'loc_salon',
      type: ProfessionalLocationType.SALON,
      isPrimary: true,
    })

    mocks.prisma.professionalLocation.findFirst.mockResolvedValue(primarySalon)

    const result = await pickBookableLocation({
      professionalId: 'pro_1',
      locationType: ServiceLocationType.SALON,
    })

    expect(mocks.prisma.professionalLocation.findFirst).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
        isBookable: true,
        type: {
          in: [
            ProfessionalLocationType.SALON,
            ProfessionalLocationType.SUITE,
          ],
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: expect.any(Object),
    })

    expect(result).toEqual(primarySalon)
  })

  it('returns null when the requested location is not a compatible bookable candidate', async () => {
    mocks.prisma.professionalLocation.findFirst.mockResolvedValue(null)

    const result = await pickBookableLocation({
      professionalId: 'pro_1',
      requestedLocationId: 'loc_wrong',
      locationType: ServiceLocationType.SALON,
    })

    expect(result).toBeNull()
  })
})