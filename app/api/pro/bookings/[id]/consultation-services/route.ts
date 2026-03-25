// app/api/pro/bookings/[id]/consultation-services/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { BookingServiceItemType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type ServiceDTO = {
  offeringId: string
  serviceId: string
  serviceName: string
  categoryName: string | null
  defaultPrice: number | null
  defaultDurationMinutes: number | null
  itemType: 'BASE'
}

type AddOnDTO = {
  parentOfferingId: string
  serviceId: string
  serviceName: string
  categoryName: string | null
  defaultPrice: number | null
  defaultDurationMinutes: number | null
  isRecommended: boolean
  itemType: 'ADD_ON'
}

type ExistingBookingItemDTO = {
  bookingServiceItemId: string
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType
  parentItemId: string | null
}

function hasToString(x: unknown): x is { toString(): string } {
  return (
    typeof x === 'object' &&
    x !== null &&
    'toString' in x &&
    typeof (x as { toString?: unknown }).toString === 'function'
  )
}

function decimalToNumber(v: unknown): number | null {
  if (v == null) return null

  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null
  }

  if (typeof v === 'string') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : null
  }

  if (hasToString(v)) {
    const n = Number(v.toString())
    return Number.isFinite(n) ? n : null
  }

  return null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function compareStrings(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const aa = (a ?? '').toLowerCase()
  const bb = (b ?? '').toLowerCase()
  if (aa < bb) return -1
  if (aa > bb) return 1
  return 0
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        serviceItems: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            serviceId: true,
            offeringId: true,
            itemType: true,
            parentItemId: true,
          },
        },
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden.')

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId: proId,
        isActive: true,
        service: { isActive: true },
      },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        serviceId: true,
        salonPriceStartingAt: true,
        salonDurationMinutes: true,
        mobilePriceStartingAt: true,
        mobileDurationMinutes: true,
        service: {
          select: {
            name: true,
            category: { select: { name: true } },
          },
        },
        addOns: {
          where: {
            isActive: true,
            addOnService: {
              isActive: true,
              isAddOnEligible: true,
            },
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            isRecommended: true,
            priceOverride: true,
            durationOverrideMinutes: true,
            addOnService: {
              select: {
                id: true,
                name: true,
                defaultDurationMinutes: true,
                minPrice: true,
                category: { select: { name: true } },
              },
            },
          },
        },
      },
      take: 500,
    })

    const services: ServiceDTO[] = offerings.map((offering) => {
      const defaultPriceRaw =
        offering.salonPriceStartingAt ?? offering.mobilePriceStartingAt ?? null
      const defaultPriceNum = decimalToNumber(defaultPriceRaw)

      const defaultDuration =
        offering.salonDurationMinutes ?? offering.mobileDurationMinutes ?? null

      return {
        offeringId: offering.id,
        serviceId: offering.serviceId,
        serviceName: offering.service?.name ?? 'Service',
        categoryName: offering.service?.category?.name ?? null,
        defaultPrice: defaultPriceNum == null ? null : round2(defaultPriceNum),
        defaultDurationMinutes: defaultDuration,
        itemType: 'BASE',
      }
    })

    const addOns: AddOnDTO[] = []

    for (const offering of offerings) {
      for (const link of offering.addOns) {
        const addOnService = link.addOnService
        if (!addOnService) continue

        const defaultPriceRaw = link.priceOverride ?? addOnService.minPrice ?? null
        const defaultPriceNum = decimalToNumber(defaultPriceRaw)

        const defaultDuration =
          link.durationOverrideMinutes ?? addOnService.defaultDurationMinutes ?? null

        addOns.push({
          parentOfferingId: offering.id,
          serviceId: addOnService.id,
          serviceName: addOnService.name,
          categoryName: addOnService.category?.name ?? null,
          defaultPrice: defaultPriceNum == null ? null : round2(defaultPriceNum),
          defaultDurationMinutes: defaultDuration,
          isRecommended: Boolean(link.isRecommended),
          itemType: 'ADD_ON',
        })
      }
    }

    services.sort((a, b) => {
      const byCategory = compareStrings(a.categoryName, b.categoryName)
      if (byCategory !== 0) return byCategory

      const byName = compareStrings(a.serviceName, b.serviceName)
      if (byName !== 0) return byName

      return compareStrings(a.offeringId, b.offeringId)
    })

    addOns.sort((a, b) => {
      const byParent = compareStrings(a.parentOfferingId, b.parentOfferingId)
      if (byParent !== 0) return byParent

      const byCategory = compareStrings(a.categoryName, b.categoryName)
      if (byCategory !== 0) return byCategory

      const byName = compareStrings(a.serviceName, b.serviceName)
      if (byName !== 0) return byName

      return compareStrings(a.serviceId, b.serviceId)
    })

    const existingBookingItems: ExistingBookingItemDTO[] = booking.serviceItems.map(
      (item) => ({
        bookingServiceItemId: item.id,
        serviceId: item.serviceId,
        offeringId: item.offeringId,
        itemType: item.itemType,
        parentItemId: item.parentItemId,
      }),
    )

    return jsonOk(
      {
        services,
        addOns,
        existingBookingItems,
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/bookings/[id]/consultation-services error', e)
    return jsonFail(500, 'Internal server error')
  }
}