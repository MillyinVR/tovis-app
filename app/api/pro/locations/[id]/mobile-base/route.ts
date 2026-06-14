// app/api/pro/locations/[id]/mobile-base/route.ts
//
// PATCH /api/pro/locations/:id/mobile-base
//
// Edits an existing MOBILE_BASE location in place (the location id is
// referenced by bookings, so the base is never recreated). Accepts a new
// base ZIP and/or travel radius:
// - postalCode: re-geocodes the ZIP, refreshes lat/lng, city/state,
//   address privacy fields, and the location timezone.
// - radiusMiles: stored on ProfessionalProfile.mobileRadiusMiles.
// Both updates keep ProfessionalProfile mobile config in sync.

import { ProfessionalLocationType } from '@prisma/client'
import { NextRequest } from 'next/server'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import {
  googleGeocodePostal,
  googleTimeZoneId,
} from '@/app/api/_utils/google'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { bumpScheduleConfigVersion } from '@/lib/booking/cacheVersion'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { refreshProfessional } from '@/lib/search/index/refreshSearchIndex'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function pickRadiusMiles(v: unknown): number | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim()
        ? Number(v)
        : NaN

  if (!Number.isFinite(n)) return null

  const miles = Math.trunc(n)

  return miles >= 1 && miles <= 200 ? miles : null
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

    const postalCode = pickString(body.postalCode) // pii-plaintext-read-ok: request body carries the new ZIP the pro is submitting, not stored PII
    const radiusMiles =
      body.radiusMiles === undefined ? undefined : pickRadiusMiles(body.radiusMiles)

    if (radiusMiles === null) {
      return jsonFail(400, 'radiusMiles must be between 1 and 200.', {
        code: 'INVALID_RADIUS',
      })
    }

    if (!postalCode && radiusMiles === undefined) {
      return jsonFail(400, 'Provide postalCode and/or radiusMiles.', {
        code: 'EMPTY_PATCH',
      })
    }

    const existing = await prisma.professionalLocation.findFirst({
      where: {
        id: locationId,
        professionalId,
      },
      select: {
        id: true,
        type: true,
        isPrimary: true,
        postalCode: true, // pii-plaintext-read-ok: pro reads own mobile base ZIP during expand-phase encryption sync
      },
    })

    if (!existing) {
      return jsonFail(404, 'Location not found')
    }

    if (existing.type !== ProfessionalLocationType.MOBILE_BASE) {
      return jsonFail(400, 'Only mobile base locations can be edited here.', {
        code: 'NOT_MOBILE_BASE',
      })
    }

    let geoUpdate: {
      effectivePostalCode: string
      city: string | null
      state: string | null
      countryCode: string | null
      lat: number
      lng: number
      timeZone: string
    } | null = null

    if (postalCode) {
      const geo = await googleGeocodePostal(postalCode)

      if (geo.lat == null || geo.lng == null) {
        return jsonFail(400, 'Could not locate that postal code.', {
          code: 'POSTAL_NOT_FOUND',
        })
      }

      const timeZone = await googleTimeZoneId(geo.lat, geo.lng)

      if (!isValidIanaTimeZone(timeZone)) {
        return jsonFail(500, 'Returned timeZoneId is not a valid IANA timezone.')
      }

      geoUpdate = {
        effectivePostalCode: geo.postalCode || postalCode,
        city: geo.city,
        state: geo.state,
        countryCode: geo.countryCode,
        lat: geo.lat,
        lng: geo.lng,
        timeZone,
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      let location: {
        id: string
        postalCode: string | null
        timeZone: string | null
      } | null = null

      if (geoUpdate) {
        const addressPrivacyData = buildAddressPrivacyWriteData({
          formattedAddress: null,
          addressLine1: null,
          addressLine2: null,
          city: geoUpdate.city,
          state: geoUpdate.state,
          postalCode: geoUpdate.effectivePostalCode,
          countryCode: geoUpdate.countryCode,
          placeId: null,
          lat: geoUpdate.lat,
          lng: geoUpdate.lng,
        })

        location = await tx.professionalLocation.update({
          where: {
            id: existing.id,
          },
          data: {
            city: geoUpdate.city,
            state: geoUpdate.state,
            postalCode: geoUpdate.effectivePostalCode,
            countryCode: geoUpdate.countryCode,

            lat: geoUpdate.lat,
            lng: geoUpdate.lng,

            ...addressPrivacyData,

            timeZone: geoUpdate.timeZone,
          },
          select: {
            id: true,
            postalCode: true, // pii-plaintext-read-ok: pro reads own mobile base ZIP during expand-phase encryption sync
            timeZone: true,
          },
        })
      }

      const profile = await tx.professionalProfile.update({
        where: {
          id: professionalId,
        },
        data: {
          ...(geoUpdate
            ? {
                mobileBasePostalCode: geoUpdate.effectivePostalCode,
                // Only the primary location drives the profile timezone.
                ...(existing.isPrimary ? { timeZone: geoUpdate.timeZone } : {}),
              }
            : {}),
          ...(radiusMiles !== undefined ? { mobileRadiusMiles: radiusMiles } : {}),
        },
        select: {
          mobileBasePostalCode: true,
          mobileRadiusMiles: true,
        },
      })

      return { location, profile }
    })

    await bumpScheduleConfigVersion(professionalId)
    // Radius lives on the profile and is denormalized into every index
    // row, so refresh the whole professional rather than one location.
    await refreshProfessional(professionalId, 'location.update')

    return jsonOk({
      locationId: existing.id,
      postalCode: updated.location?.postalCode ?? existing.postalCode,
      timeZone: updated.location?.timeZone ?? null,
      mobileBasePostalCode: updated.profile.mobileBasePostalCode,
      mobileRadiusMiles: updated.profile.mobileRadiusMiles,
    })
  } catch (error: unknown) {
    console.error('PATCH /api/pro/locations/[id]/mobile-base error', error)

    const message = error instanceof Error ? error.message : 'Internal error'

    return jsonFail(500, message, {
      code: 'INTERNAL',
    })
  }
}
