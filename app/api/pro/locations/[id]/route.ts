// app/api/pro/locations/[id]/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { pickBool, pickNumber, pickString } from '@/lib/pick'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { isRecord, type UnknownRecord, hasOwn } from '@/lib/guards'
import {
  normalizeWorkingHours,
  toInputJsonValue,
} from '@/lib/scheduling/workingHoursValidation'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function readParams(ctx: Params) {
  return await ctx.params
}

function requireAddressForType(t: ProfessionalLocationType) {
  return t === ProfessionalLocationType.SALON || t === ProfessionalLocationType.SUITE
}

export async function PATCH(req: NextRequest, ctx: Params) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await readParams(ctx)
    const locationId = pickString(id)
    if (!locationId) return jsonFail(400, 'Missing id')

    const raw: unknown = await req.json().catch(() => ({}))
    const body: UnknownRecord = isRecord(raw) ? raw : {}

    const existing = await prisma.professionalLocation.findFirst({
      where: { id: locationId, professionalId },
      select: {
        id: true,
        type: true,
        isPrimary: true,
        isBookable: true,
        timeZone: true,
        placeId: true,
        formattedAddress: true,
        lat: true,
        lng: true,
        workingHours: true,
      },
    })

    if (!existing) return jsonFail(404, 'Location not found')

    const data: Prisma.ProfessionalLocationUpdateManyMutationInput = {}

    if (hasOwn(body, 'name')) {
      data.name = pickString(body.name)
    }

    let requestedPrimary: boolean | null = null
    if (hasOwn(body, 'isPrimary')) {
      const b = pickBool(body.isPrimary)
      if (b === null) return jsonFail(400, 'isPrimary must be boolean')
      requestedPrimary = b

      if (requestedPrimary === false && existing.isPrimary) {
        return jsonFail(
          400,
          'Cannot unset primary directly. Set another location as primary instead.',
        )
      }

      data.isPrimary = requestedPrimary
    }

    let requestedBookable: boolean | undefined
    if (hasOwn(body, 'isBookable')) {
      const b = pickBool(body.isBookable)
      if (b === null) return jsonFail(400, 'isBookable must be boolean')
      requestedBookable = b
      data.isBookable = b
    }

    const placeIdIn = hasOwn(body, 'placeId') ? pickString(body.placeId) : undefined
    if (placeIdIn !== undefined) data.placeId = placeIdIn

    const formattedAddressIn = hasOwn(body, 'formattedAddress')
      ? pickString(body.formattedAddress)
      : undefined
    if (formattedAddressIn !== undefined) data.formattedAddress = formattedAddressIn

    if (hasOwn(body, 'addressLine1')) {
      data.addressLine1 = pickString(body.addressLine1)
    }

    if (hasOwn(body, 'addressLine2')) {
      data.addressLine2 = pickString(body.addressLine2)
    }

    if (hasOwn(body, 'city')) {
      data.city = pickString(body.city)
    }

    if (hasOwn(body, 'state')) {
      data.state = pickString(body.state)
    }

    if (hasOwn(body, 'postalCode')) {
      data.postalCode = pickString(body.postalCode)
    }

    if (hasOwn(body, 'countryCode')) {
      data.countryCode = pickString(body.countryCode)
    }

    let latIn: Prisma.Decimal | null | undefined
    if (hasOwn(body, 'lat')) {
      if (body.lat === null) {
        latIn = null
      } else {
        const n = pickNumber(body.lat)
        if (n == null) return jsonFail(400, 'lat must be a number or null')
        latIn = new Prisma.Decimal(String(n))
      }

      data.lat = latIn
    }

    let lngIn: Prisma.Decimal | null | undefined
    if (hasOwn(body, 'lng')) {
      if (body.lng === null) {
        lngIn = null
      } else {
        const n = pickNumber(body.lng)
        if (n == null) return jsonFail(400, 'lng must be a number or null')
        lngIn = new Prisma.Decimal(String(n))
      }

      data.lng = lngIn
    }

    const timeZoneIn = hasOwn(body, 'timeZone') ? pickString(body.timeZone) : undefined
    if (timeZoneIn !== undefined) {
      data.timeZone = timeZoneIn
    }

    const workingHoursIn = hasOwn(body, 'workingHours')
      ? normalizeWorkingHours(body.workingHours)
      : undefined

    if (hasOwn(body, 'workingHours')) {
      if (!workingHoursIn) {
        return jsonFail(
          400,
          'workingHours must contain mon..sun with { enabled, start, end }, valid HH:MM times, and end after start.',
        )
      }

      data.workingHours = toInputJsonValue(workingHoursIn)
    }

    const nextIsBookable =
      typeof requestedBookable === 'boolean'
        ? requestedBookable
        : Boolean(existing.isBookable)

    const nextTimeZone =
      timeZoneIn !== undefined ? timeZoneIn : existing.timeZone ?? null

    const nextPlaceId =
      placeIdIn !== undefined ? placeIdIn : existing.placeId ?? null

    const nextFormattedAddress =
      formattedAddressIn !== undefined
        ? formattedAddressIn
        : existing.formattedAddress ?? null

    const nextLat = latIn !== undefined ? latIn : existing.lat ?? null
    const nextLng = lngIn !== undefined ? lngIn : existing.lng ?? null

    const nextWorkingHours =
      workingHoursIn !== undefined
        ? workingHoursIn
        : normalizeWorkingHours(existing.workingHours)

    if (nextIsBookable) {
      if (!nextTimeZone || !isValidIanaTimeZone(nextTimeZone)) {
        return jsonFail(400, 'Bookable locations must have a valid IANA timeZone.')
      }

      if (!nextWorkingHours) {
        return jsonFail(
          400,
          'Bookable locations must have valid workingHours with mon..sun, valid HH:MM times, and end after start.',
        )
      }

      if (nextLat == null || nextLng == null) {
        return jsonFail(400, 'Bookable locations must include lat/lng.')
      }

      if (requireAddressForType(existing.type)) {
        if (!nextPlaceId || !nextFormattedAddress) {
          return jsonFail(
            400,
            'Salon/Suite bookable locations require placeId and formattedAddress.',
          )
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      if (requestedPrimary === true) {
        await tx.professionalLocation.updateMany({
          where: { professionalId, isPrimary: true },
          data: { isPrimary: false },
        })
      }

      const updated = await tx.professionalLocation.updateMany({
        where: { id: locationId, professionalId },
        data,
      })

      if (updated.count !== 1) return null

      return await tx.professionalLocation.findFirst({
        where: { id: locationId, professionalId },
        select: {
          id: true,
          isPrimary: true,
          isBookable: true,
          timeZone: true,
          type: true,
        },
      })
    })

    if (!result) return jsonFail(404, 'Location not found')
    return jsonOk({ location: result })
  } catch (e) {
    console.error('PATCH /api/pro/locations/[id] error', e)
    const msg = e instanceof Error ? e.message : 'Failed to update location'
    return jsonFail(500, msg)
  }
}

export async function DELETE(_req: NextRequest, ctx: Params) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await readParams(ctx)
    const locationId = pickString(id)
    if (!locationId) return jsonFail(400, 'Missing id')

    try {
      const deleted = await prisma.professionalLocation.deleteMany({
        where: { id: locationId, professionalId },
      })

      if (deleted.count !== 1) return jsonFail(404, 'Location not found')
      return jsonOk({})
    } catch (e: unknown) {
      const code = isRecord(e)
        ? pickString((e as Record<string, unknown>).code)
        : null

      const message =
        e instanceof Error
          ? e.message
          : isRecord(e)
            ? pickString((e as Record<string, unknown>).message)
            : null

      if (
        code === 'P2003' ||
        (message &&
          (message.includes('Foreign key constraint') ||
            message.includes('violates foreign key')))
      ) {
        return jsonFail(
          409,
          'This location is used by existing bookings and cannot be deleted.',
        )
      }

      throw e
    }
  } catch (e) {
    console.error('DELETE /api/pro/locations/[id] error', e)
    const msg = e instanceof Error ? e.message : 'Failed to delete location'
    return jsonFail(500, msg)
  }
}