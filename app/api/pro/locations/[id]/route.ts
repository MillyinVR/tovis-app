// app/api/pro/locations/[id]/route.ts

import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { NextRequest } from 'next/server'

import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { bumpScheduleConfigVersion } from '@/lib/booking/cacheVersion'
import { hasOwn, isRecord, type UnknownRecord } from '@/lib/guards'
import { pickBool, pickNumber, pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { evaluatePublishableLocation } from '@/lib/pro/readiness/proReadiness'
import {
  deleteLocationFromIndex,
  refreshLocation,
} from '@/lib/search/index/refreshSearchIndex'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import {
  normalizeWorkingHours,
  toInputJsonValue,
} from '@/lib/scheduling/workingHoursValidation'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

type ExistingLocation = {
  id: string
  type: ProfessionalLocationType
  isPrimary: boolean
  isBookable: boolean
  timeZone: string | null
  placeId: string | null
  formattedAddress: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  lat: Prisma.Decimal | null
  lng: Prisma.Decimal | null
  workingHours: unknown
}

function requireAddressForType(type: ProfessionalLocationType) {
  return (
    type === ProfessionalLocationType.SALON ||
    type === ProfessionalLocationType.SUITE
  )
}

async function readParams(ctx: Params) {
  return await ctx.params
}

function decimalToNumber(value: Prisma.Decimal | null): number | null {
  if (value == null) return null
  return value.toNumber()
}

function decimalOrNull(value: number | null | undefined) {
  if (value == null) return null
  return new Prisma.Decimal(String(value))
}

function decimalInputToNumber(
  value: Prisma.Decimal | null | undefined,
): number | null {
  if (value == null) return null
  return value.toNumber()
}

export async function PATCH(req: NextRequest, ctx: Params) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const limited = await enforceRateLimit({
      bucket: 'pro:locations:write',
      identity: await rateLimitIdentity(auth.userId),
    })
    if (limited) return limited

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
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        countryCode: true,
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
      const parsedPrimary = pickBool(body.isPrimary)
      if (parsedPrimary === null) return jsonFail(400, 'isPrimary must be boolean')

      requestedPrimary = parsedPrimary

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
      const parsedBookable = pickBool(body.isBookable)
      if (parsedBookable === null) {
        return jsonFail(400, 'isBookable must be boolean')
      }

      if (existing.isBookable === false && parsedBookable === true) {
        return jsonFail(
          409,
          'Use the schedule publish endpoint to make a location bookable.',
          {
            code: 'USE_SCHEDULE_PUBLISH',
          },
        )
      }

      requestedBookable = parsedBookable
      data.isBookable = parsedBookable
    }

    const placeIdIn = hasOwn(body, 'placeId')
      ? pickString(body.placeId)
      : undefined
    if (placeIdIn !== undefined) data.placeId = placeIdIn

    const formattedAddressIn = hasOwn(body, 'formattedAddress')
      ? pickString(body.formattedAddress)
      : undefined
    if (formattedAddressIn !== undefined) {
      data.formattedAddress = formattedAddressIn
    }

    const addressLine1In = hasOwn(body, 'addressLine1')
      ? pickString(body.addressLine1)
      : undefined
    if (addressLine1In !== undefined) data.addressLine1 = addressLine1In

    const addressLine2In = hasOwn(body, 'addressLine2')
      ? pickString(body.addressLine2)
      : undefined
    if (addressLine2In !== undefined) data.addressLine2 = addressLine2In

    const cityIn = hasOwn(body, 'city') ? pickString(body.city) : undefined
    if (cityIn !== undefined) data.city = cityIn

    const stateIn = hasOwn(body, 'state') ? pickString(body.state) : undefined
    if (stateIn !== undefined) data.state = stateIn

    const postalCodeIn = hasOwn(body, 'postalCode')
      ? pickString(body.postalCode)
      : undefined
    if (postalCodeIn !== undefined) data.postalCode = postalCodeIn

    const countryCodeIn = hasOwn(body, 'countryCode')
      ? pickString(body.countryCode)
      : undefined
    if (countryCodeIn !== undefined) data.countryCode = countryCodeIn

    let latIn: Prisma.Decimal | null | undefined
    let latNumberIn: number | null | undefined
    if (hasOwn(body, 'lat')) {
      if (body.lat === null) {
        latIn = null
        latNumberIn = null
      } else {
        const parsedLat = pickNumber(body.lat)
        if (parsedLat == null) return jsonFail(400, 'lat must be a number or null')

        latNumberIn = parsedLat
        latIn = decimalOrNull(parsedLat)
      }

      data.lat = latIn
    }

    let lngIn: Prisma.Decimal | null | undefined
    let lngNumberIn: number | null | undefined
    if (hasOwn(body, 'lng')) {
      if (body.lng === null) {
        lngIn = null
        lngNumberIn = null
      } else {
        const parsedLng = pickNumber(body.lng)
        if (parsedLng == null) return jsonFail(400, 'lng must be a number or null')

        lngNumberIn = parsedLng
        lngIn = decimalOrNull(parsedLng)
      }

      data.lng = lngIn
    }

    const timeZoneIn = hasOwn(body, 'timeZone')
      ? pickString(body.timeZone)
      : undefined
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

    const nextAddressLine1 =
      addressLine1In !== undefined ? addressLine1In : existing.addressLine1 ?? null

    const nextAddressLine2 =
      addressLine2In !== undefined ? addressLine2In : existing.addressLine2 ?? null

    const nextCity = cityIn !== undefined ? cityIn : existing.city ?? null
    const nextState = stateIn !== undefined ? stateIn : existing.state ?? null
    const nextPostalCode =
      postalCodeIn !== undefined ? postalCodeIn : existing.postalCode ?? null
    const nextCountryCode =
      countryCodeIn !== undefined ? countryCodeIn : existing.countryCode ?? null

    const nextLatDecimal = latIn !== undefined ? latIn : existing.lat ?? null
    const nextLngDecimal = lngIn !== undefined ? lngIn : existing.lng ?? null

    const nextLat =
      latNumberIn !== undefined
        ? latNumberIn
        : decimalInputToNumber(existing.lat)

    const nextLng =
      lngNumberIn !== undefined
        ? lngNumberIn
        : decimalInputToNumber(existing.lng)

    const nextWorkingHours =
      workingHoursIn !== undefined
        ? workingHoursIn
        : normalizeWorkingHours(existing.workingHours)

    if (nextIsBookable) {
      const publishable = evaluatePublishableLocation({
        id: existing.id,
        type: existing.type,
        formattedAddress: nextFormattedAddress,
        timeZone: nextTimeZone,
        workingHours: nextWorkingHours,
      })

      if (!publishable.ok) {
        return jsonFail(
          400,
          'Bookable locations must have valid timezone, working hours, and address requirements.',
          {
            blockers: publishable.blockers,
          },
        )
      }

      if (nextLatDecimal == null || nextLngDecimal == null) {
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

    const hasAddressPrivacyRelevantChange =
      placeIdIn !== undefined ||
      formattedAddressIn !== undefined ||
      addressLine1In !== undefined ||
      addressLine2In !== undefined ||
      cityIn !== undefined ||
      stateIn !== undefined ||
      postalCodeIn !== undefined ||
      countryCodeIn !== undefined ||
      latIn !== undefined ||
      lngIn !== undefined

    if (hasAddressPrivacyRelevantChange) {
      Object.assign(
        data,
        buildAddressPrivacyWriteData({
          formattedAddress: nextFormattedAddress,
          addressLine1: nextAddressLine1,
          addressLine2: nextAddressLine2,
          city: nextCity,
          state: nextState,
          postalCode: nextPostalCode,
          countryCode: nextCountryCode,
          placeId: nextPlaceId,
          lat: nextLat,
          lng: nextLng,
        }),
      )
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

    await bumpScheduleConfigVersion(professionalId)
    await refreshLocation(locationId, 'location.update')

    return jsonOk({ location: result })
  } catch (error) {
    console.error('PATCH /api/pro/locations/[id] error', error)
    const msg = error instanceof Error ? error.message : 'Failed to update location'
    return jsonFail(500, msg)
  }
}

export async function DELETE(_req: NextRequest, ctx: Params) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const limited = await enforceRateLimit({
      bucket: 'pro:locations:write',
      identity: await rateLimitIdentity(auth.userId),
    })
    if (limited) return limited

    const { id } = await readParams(ctx)
    const locationId = pickString(id)

    if (!locationId) return jsonFail(400, 'Missing id')

    try {
      const deleted = await prisma.professionalLocation.deleteMany({
        where: { id: locationId, professionalId },
      })

      if (deleted.count !== 1) return jsonFail(404, 'Location not found')

      await bumpScheduleConfigVersion(professionalId)
      await deleteLocationFromIndex(locationId)

      return jsonOk({})
    } catch (error: unknown) {
      const code = isRecord(error)
        ? pickString((error as Record<string, unknown>).code)
        : null

      const message =
        error instanceof Error
          ? error.message
          : isRecord(error)
            ? pickString((error as Record<string, unknown>).message)
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

      throw error
    }
  } catch (error) {
    console.error('DELETE /api/pro/locations/[id] error', error)
    const msg = error instanceof Error ? error.message : 'Failed to delete location'
    return jsonFail(500, msg)
  }
}