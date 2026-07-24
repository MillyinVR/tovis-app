// lib/availability/data/addOnContext.ts

import { Prisma, ServiceLocationType } from '@prisma/client'

import {
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import {
  buildOfferingAddOnWhere,
  resolveAddOnDurationMinutes,
} from '@/lib/booking/addOnDuration'
import { type BookingErrorCode } from '@/lib/booking/errors'
import { clampInt } from '@/lib/pick'
import { prisma } from '@/lib/prisma'

type AvailabilityDbClient = Prisma.TransactionClient | typeof prisma

export type ResolveDurationWithAddOnsArgs = {
  professionalId: string
  offeringId: string
  addOnIds: string[]
  locationType: ServiceLocationType
  baseDurationMinutes: number
  client?: AvailabilityDbClient
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

  const client = args.client ?? prisma

  const addOnLinks = await client.offeringAddOn.findMany({
    where: buildOfferingAddOnWhere({
      addOnIds: args.addOnIds,
      offeringId: args.offeringId,
      locationType: args.locationType,
    }),
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

  const proAddOnOfferings = await client.professionalServiceOffering.findMany({
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

  // Same resolver, same refusal as the write path (`resolveBookingAddOns`): a
  // link whose duration chain lands on a non-positive number is ADDONS_INVALID
  // here too. Summing it as zero used to size the offered slot SHORTER than the
  // window finalize would demand — the B1-A defect one layer down.
  let addOnDurationTotal = 0

  for (const link of addOnLinks) {
    const minutes = resolveAddOnDurationMinutes({
      durationOverrideMinutes: link.durationOverrideMinutes,
      proOffering: proOfferingByServiceId.get(link.addOnServiceId) ?? null,
      defaultDurationMinutes: link.addOnService.defaultDurationMinutes,
      locationType: args.locationType,
    })

    if (minutes == null) {
      return {
        ok: false,
        code: 'ADDONS_INVALID',
      }
    }

    addOnDurationTotal += minutes
  }

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