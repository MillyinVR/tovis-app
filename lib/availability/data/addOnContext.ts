// lib/availability/data/addOnContext.ts

import { ServiceLocationType } from '@prisma/client'

import {
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { type BookingErrorCode } from '@/lib/booking/errors'
import { clampInt } from '@/lib/pick'
import { prisma } from '@/lib/prisma'

export type ResolveDurationWithAddOnsArgs = {
  professionalId: string
  offeringId: string
  addOnIds: string[]
  locationType: ServiceLocationType
  baseDurationMinutes: number
}

export type ResolveDurationWithAddOnsResult =
  | {
      ok: true
      durationMinutes: number
      addOnDurationTotal: number
    }
  | {
      ok: false
      code: Extract<BookingErrorCode, 'ADDONS_INVALID'>
    }

export async function resolveDurationWithAddOns(
  args: ResolveDurationWithAddOnsArgs,
): Promise<ResolveDurationWithAddOnsResult> {
  if (!args.addOnIds.length) {
    return {
      ok: true,
      durationMinutes: args.baseDurationMinutes,
      addOnDurationTotal: 0,
    }
  }

  const addOnLinks = await prisma.offeringAddOn.findMany({
    where: {
      id: { in: args.addOnIds },
      offeringId: args.offeringId,
      isActive: true,
      OR: [{ locationType: null }, { locationType: args.locationType }],
      addOnService: {
        isActive: true,
        isAddOnEligible: true,
      },
    },
    select: {
      id: true,
      addOnServiceId: true,
      durationOverrideMinutes: true,
      addOnService: {
        select: {
          defaultDurationMinutes: true,
        },
      },
    },
    take: 50,
  })

  if (addOnLinks.length !== args.addOnIds.length) {
    return {
      ok: false,
      code: 'ADDONS_INVALID',
    }
  }

  const addOnServiceIds = addOnLinks.map((link) => link.addOnServiceId)

  const proAddOnOfferings = await prisma.professionalServiceOffering.findMany({
    where: {
      professionalId: args.professionalId,
      isActive: true,
      serviceId: { in: addOnServiceIds },
    },
    select: {
      serviceId: true,
      salonDurationMinutes: true,
      mobileDurationMinutes: true,
    },
    take: 200,
  })

  const proOfferingByServiceId = new Map(
    proAddOnOfferings.map((offering) => [offering.serviceId, offering]),
  )

  const addOnDurationTotal = addOnLinks.reduce((sum, link) => {
    const proOffering = proOfferingByServiceId.get(link.addOnServiceId) ?? null

    const rawDuration =
      link.durationOverrideMinutes ??
      (args.locationType === ServiceLocationType.MOBILE
        ? proOffering?.mobileDurationMinutes
        : proOffering?.salonDurationMinutes) ??
      link.addOnService.defaultDurationMinutes ??
      0

    const duration = Number(rawDuration || 0)
    return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0)
  }, 0)

  return {
    ok: true,
    durationMinutes: clampInt(
      args.baseDurationMinutes + addOnDurationTotal,
      15,
      MAX_SLOT_DURATION_MINUTES,
    ),
    addOnDurationTotal,
  }
}