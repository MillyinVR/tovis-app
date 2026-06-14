// app/api/pro/locations/[id]/route.ts

import { type Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'

import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { bumpScheduleConfigVersion } from '@/lib/booking/cacheVersion'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { hasOwn, isRecord, type UnknownRecord } from '@/lib/guards'
import { pickBool, pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { evaluatePublishableLocation } from '@/lib/pro/readiness/proReadiness'
import {
  deleteLocationFromIndex,
  refreshLocation,
} from '@/lib/search/index/refreshSearchIndex'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import {
  buildProfessionalLocationAddressPrivacyInput,
  mapProfessionalLocation,
  parseNullableProfessionalLocationCoordinate,
  parseProfessionalLocationAddressInput,
  PROFESSIONAL_LOCATION_SELECT,
  professionalLocationDecimalToNumber,
  professionalLocationNumberToDecimalOrNull,
  requiresAddressForBookableProfessionalLocation,
} from '@/lib/proLocations/locationInput'
import {
  normalizeWorkingHours,
  toInputJsonValue,
} from '@/lib/scheduling/workingHoursValidation'

export const dynamic = 'force-dynamic'

type OwnedLocationRow = Prisma.ProfessionalLocationGetPayload<{
  select: typeof PROFESSIONAL_LOCATION_SELECT
}>

async function loadOwnedLocation(args: {
  locationId: string
  professionalId: string
}): Promise<OwnedLocationRow | null> {
  return await prisma.professionalLocation.findFirst({
    where: {
      id: args.locationId,
      professionalId: args.professionalId,
    },
    select: PROFESSIONAL_LOCATION_SELECT,
  })
}

function pickNullablePatchString(
  body: UnknownRecord,
  key: string,
): string | null | undefined {
  return hasOwn(body, key) ? pickString(body[key]) : undefined
}

function hasAddressPrivacyRelevantChange(body: UnknownRecord): boolean {
  return (
    hasOwn(body, 'placeId') ||
    hasOwn(body, 'formattedAddress') ||
    hasOwn(body, 'addressLine1') ||
    hasOwn(body, 'addressLine2') ||
    hasOwn(body, 'city') ||
    hasOwn(body, 'state') ||
    hasOwn(body, 'postalCode') ||
    hasOwn(body, 'countryCode') ||
    hasOwn(body, 'lat') ||
    hasOwn(body, 'lng')
  )
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const limited = await enforceRateLimit({
      bucket: 'pro:locations:write',
      identity: await rateLimitIdentity(auth.userId),
    })
    if (limited) return limited

    const { id } = await resolveRouteParams(ctx)
    const locationId = pickString(id)

    if (!locationId) {
      return jsonFail(400, 'Missing id')
    }

    const body = await readJsonRecord(req)

    const existing = await loadOwnedLocation({
      locationId,
      professionalId,
    })

    if (!existing) {
      return jsonFail(404, 'Location not found')
    }

    const data: Prisma.ProfessionalLocationUpdateManyMutationInput = {}

    if (hasOwn(body, 'name')) {
      data.name = pickString(body.name)
    }

    let requestedPrimary: boolean | null = null

    if (hasOwn(body, 'isPrimary')) {
      const parsedPrimary = pickBool(body.isPrimary)

      if (parsedPrimary === null) {
        return jsonFail(400, 'isPrimary must be boolean')
      }

      requestedPrimary = parsedPrimary

      if (!requestedPrimary && existing.isPrimary) {
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

      if (!existing.isBookable && parsedBookable) {
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

    const placeIdIn = pickNullablePatchString(body, 'placeId')
    const formattedAddressIn = pickNullablePatchString(body, 'formattedAddress')
    const addressLine1In = pickNullablePatchString(body, 'addressLine1')
    const addressLine2In = pickNullablePatchString(body, 'addressLine2')
    const cityIn = pickNullablePatchString(body, 'city')
    const stateIn = pickNullablePatchString(body, 'state')
    const postalCodeIn = pickNullablePatchString(body, 'postalCode')
    const countryCodeIn = pickNullablePatchString(body, 'countryCode')

    if (placeIdIn !== undefined) data.placeId = placeIdIn
    if (formattedAddressIn !== undefined) data.formattedAddress = formattedAddressIn
    if (addressLine1In !== undefined) data.addressLine1 = addressLine1In // pii-plaintext-read-ok: pro location patch writes plaintext legacy address column during expand-phase encryption sync
    if (addressLine2In !== undefined) data.addressLine2 = addressLine2In // pii-plaintext-read-ok: pro location patch writes plaintext legacy address column during expand-phase encryption sync
    if (cityIn !== undefined) data.city = cityIn
    if (stateIn !== undefined) data.state = stateIn
    if (postalCodeIn !== undefined) data.postalCode = postalCodeIn // pii-plaintext-read-ok: pro location patch writes plaintext legacy postal column during expand-phase encryption sync
    if (countryCodeIn !== undefined) data.countryCode = countryCodeIn

    const lat = parseNullableProfessionalLocationCoordinate({
      body,
      key: 'lat',
    })
    if (!lat.ok) return jsonFail(400, lat.error)

    const lng = parseNullableProfessionalLocationCoordinate({
      body,
      key: 'lng',
    })
    if (!lng.ok) return jsonFail(400, lng.error)

    if (lat.value !== undefined) {
      data.lat = professionalLocationNumberToDecimalOrNull(lat.value)
    }

    if (lng.value !== undefined) {
      data.lng = professionalLocationNumberToDecimalOrNull(lng.value)
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

    const nextAddress = {
      formattedAddress:
        formattedAddressIn !== undefined
          ? formattedAddressIn
          : existing.formattedAddress ?? null,
      addressLine1:
        addressLine1In !== undefined ? addressLine1In : existing.addressLine1 ?? null, // pii-plaintext-read-ok: pro location patch reuses existing plaintext legacy address only to rebuild encrypted privacy payload
      addressLine2:
        addressLine2In !== undefined ? addressLine2In : existing.addressLine2 ?? null, // pii-plaintext-read-ok: pro location patch reuses existing plaintext legacy address only to rebuild encrypted privacy payload
      city: cityIn !== undefined ? cityIn : existing.city ?? null,
      state: stateIn !== undefined ? stateIn : existing.state ?? null,
      postalCode:
        postalCodeIn !== undefined ? postalCodeIn : existing.postalCode ?? null, // pii-plaintext-read-ok: pro location patch reuses existing plaintext legacy postal code only to rebuild encrypted privacy payload
      countryCode:
        countryCodeIn !== undefined ? countryCodeIn : existing.countryCode ?? null,
      placeId: placeIdIn !== undefined ? placeIdIn : existing.placeId ?? null,
      latRaw:
        lat.value !== undefined
          ? lat.value
          : professionalLocationDecimalToNumber(existing.lat),
      lngRaw:
        lng.value !== undefined
          ? lng.value
          : professionalLocationDecimalToNumber(existing.lng),
    }

    const nextWorkingHours =
      workingHoursIn !== undefined
        ? workingHoursIn
        : normalizeWorkingHours(existing.workingHours)

    if (nextIsBookable) {
      const publishable = evaluatePublishableLocation({
        id: existing.id,
        type: existing.type,
        formattedAddress: nextAddress.formattedAddress,
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

      if (nextAddress.latRaw == null || nextAddress.lngRaw == null) {
        return jsonFail(400, 'Bookable locations must include lat/lng.')
      }

      if (
        requiresAddressForBookableProfessionalLocation(existing.type) &&
        (!nextAddress.placeId || !nextAddress.formattedAddress)
      ) {
        return jsonFail(
          400,
          'Salon/Suite bookable locations require placeId and formattedAddress.',
        )
      }
    }

    if (hasAddressPrivacyRelevantChange(body)) {
      Object.assign(
        data,
        buildAddressPrivacyWriteData(
          buildProfessionalLocationAddressPrivacyInput(nextAddress),
        ),
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      if (requestedPrimary === true) {
        await tx.professionalLocation.updateMany({
          where: {
            professionalId,
            isPrimary: true,
          },
          data: {
            isPrimary: false,
          },
        })
      }

      const updated = await tx.professionalLocation.updateMany({
        where: {
          id: locationId,
          professionalId,
        },
        data,
      })

      if (updated.count !== 1) {
        return null
      }

      return tx.professionalLocation.findFirst({
        where: {
          id: locationId,
          professionalId,
        },
        select: PROFESSIONAL_LOCATION_SELECT,
      })
    })

    if (!result) {
      return jsonFail(404, 'Location not found')
    }

    await bumpScheduleConfigVersion(professionalId)
    await refreshLocation(locationId, 'location.update')

    return jsonOk({
      location: mapProfessionalLocation(result),
    })
  } catch (error) {
    console.error('PATCH /api/pro/locations/[id] error', error)

    const msg =
      error instanceof Error ? error.message : 'Failed to update location'

    return jsonFail(500, msg)
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const limited = await enforceRateLimit({
      bucket: 'pro:locations:write',
      identity: await rateLimitIdentity(auth.userId),
    })
    if (limited) return limited

    const { id } = await resolveRouteParams(ctx)
    const locationId = pickString(id)

    if (!locationId) {
      return jsonFail(400, 'Missing id')
    }

    try {
      const deleted = await prisma.professionalLocation.deleteMany({
        where: {
          id: locationId,
          professionalId,
        },
      })

      if (deleted.count !== 1) {
        return jsonFail(404, 'Location not found')
      }

      await bumpScheduleConfigVersion(professionalId)
      await deleteLocationFromIndex(locationId)

      return jsonOk({})
    } catch (error: unknown) {
      const code = isRecord(error) ? pickString(error.code) : null

      const message =
        error instanceof Error
          ? error.message
          : isRecord(error)
            ? pickString(error.message)
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

    const msg =
      error instanceof Error ? error.message : 'Failed to delete location'

    return jsonFail(500, msg)
  }
}