// app/api/pro/onboarding/location/route.ts

import { ProfessionalLocationType, type Prisma } from '@prisma/client'

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import {
  googleGeocodePostal,
  googlePlaceDetails,
  googleTimeZoneId,
} from '@/app/api/_utils/google'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { bumpScheduleConfigVersion } from '@/lib/booking/cacheVersion'
import { prisma } from '@/lib/prisma'
import { refreshLocation } from '@/lib/search/index/refreshSearchIndex'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type OnboardingLocationMode = 'SALON' | 'SUITE' | 'MOBILE'

function normalizeMode(v: unknown): OnboardingLocationMode | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''

  if (s === 'SALON') return 'SALON'
  if (s === 'SUITE') return 'SUITE'
  if (s === 'MOBILE') return 'MOBILE'

  return null
}

function pickInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.trunc(v)
  }

  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }

  return null
}

function pickBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function normalizeAdvanceNoticeMinutes(v: unknown): number {
  const parsed = pickInt(v)

  if (parsed == null) return 15

  return Math.max(0, Math.min(parsed, 30 * 24 * 60))
}

function defaultWorkingHours(): Prisma.JsonObject {
  return {
    mon: { enabled: true, start: '09:00', end: '17:00' },
    tue: { enabled: true, start: '09:00', end: '17:00' },
    wed: { enabled: true, start: '09:00', end: '17:00' },
    thu: { enabled: true, start: '09:00', end: '17:00' },
    fri: { enabled: true, start: '09:00', end: '17:00' },
    sat: { enabled: false, start: '09:00', end: '17:00' },
    sun: { enabled: false, start: '09:00', end: '17:00' },
  }
}

async function googleTimeZone(lat: number, lng: number): Promise<string> {
  const timeZone = await googleTimeZoneId(lat, lng)

  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error('Returned timeZoneId is not a valid IANA timezone.')
  }

  return timeZone
}

function kmToMilesInt(km: number): number {
  return Math.max(1, Math.min(200, Math.round(km * 0.621371)))
}

async function syncDraftLocationSideEffects(args: {
  professionalId: string
  locationId: string
}): Promise<void> {
  await bumpScheduleConfigVersion(args.professionalId)
  await refreshLocation(args.locationId, 'location.create')
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const professionalId = auth.professionalId

    const body = await readJsonRecord(req)

    const mode = normalizeMode(body.mode)

    if (!mode) {
      return jsonFail(400, 'Missing or invalid mode.', {
        code: 'INVALID_MODE',
      })
    }

    const makePrimary = pickBool(body.makePrimary) ?? true
    const advanceNoticeMinutes = normalizeAdvanceNoticeMinutes(
      body.advanceNoticeMinutes,
    )
    const workingHours = defaultWorkingHours()

    if (mode === 'SALON' || mode === 'SUITE') {
      const placeId = pickString(body.placeId)

      if (!placeId) {
        return jsonFail(400, 'Missing placeId.', {
          code: 'MISSING_PLACE',
        })
      }

      const sessionToken = pickString(body.sessionToken) || null
      const loc = await googlePlaceDetails(placeId, sessionToken)

      if (loc.lat == null || loc.lng == null) {
        return jsonFail(400, 'Selected place is missing coordinates.', {
          code: 'PLACE_NO_GEO',
        })
      }

      const timeZone = await googleTimeZone(loc.lat, loc.lng)
      const nameOverride = pickString(body.locationName)

      const locationType =
        mode === 'SALON'
          ? ProfessionalLocationType.SALON
          : ProfessionalLocationType.SUITE

      const addressPrivacyData = buildAddressPrivacyWriteData({
        formattedAddress: loc.formattedAddress,
        addressLine1: null,
        addressLine2: null,
        city: loc.city,
        state: loc.state,
        postalCode: loc.postalCode,
        countryCode: loc.countryCode,
        placeId: loc.placeId,
        lat: loc.lat,
        lng: loc.lng,
      })

      const created = await prisma.$transaction(async (tx) => {
        if (makePrimary) {
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

        const mobileBaseCount = await tx.professionalLocation.count({
          where: {
            professionalId,
            type: ProfessionalLocationType.MOBILE_BASE,
          },
        })

        const createdLocation = await tx.professionalLocation.create({
          data: {
            professionalId,
            type: locationType,
            name: (nameOverride || loc.name || '').trim() || null,
            isPrimary: makePrimary,

            // Onboarding creates a draft location only.
            // Publishing/bookability must go through /api/pro/schedule/publish.
            isBookable: false,

            formattedAddress: loc.formattedAddress,
            city: loc.city,
            state: loc.state,
            postalCode: loc.postalCode,
            countryCode: loc.countryCode,
            placeId: loc.placeId,

            lat: loc.lat,
            lng: loc.lng,

            ...addressPrivacyData,

            timeZone,
            advanceNoticeMinutes,
            workingHours,
          },
          select: {
            id: true,
            type: true,
            timeZone: true,
            isPrimary: true,
            isBookable: true,
            advanceNoticeMinutes: true,
          },
        })

        // Adding a salon/suite must not break an existing mobile setup —
        // only clear the profile's mobile config when no mobile base remains.
        await tx.professionalProfile.update({
          where: {
            id: professionalId,
          },
          data: {
            timeZone,
            ...(mobileBaseCount === 0
              ? {
                  mobileBasePostalCode: null,
                  mobileRadiusMiles: null,
                }
              : {}),
          },
          select: {
            id: true,
          },
        })

        return createdLocation
      })

      await syncDraftLocationSideEffects({
        professionalId,
        locationId: created.id,
      })

      return jsonOk({
        location: created,
      })
    }

    const postalCode = pickString(body.postalCode)

    if (!postalCode) {
      return jsonFail(400, 'Missing postalCode.', {
        code: 'MISSING_POSTAL',
      })
    }

    const radiusMilesRaw = pickInt(body.radiusMiles)
    const radiusKmRaw = pickInt(body.radiusKm)

    const radiusMiles =
      radiusMilesRaw && radiusMilesRaw >= 1 && radiusMilesRaw <= 200
        ? radiusMilesRaw
        : radiusKmRaw && radiusKmRaw >= 1 && radiusKmRaw <= 400
          ? kmToMilesInt(radiusKmRaw)
          : null

    if (!radiusMiles) {
      return jsonFail(
        400,
        'Invalid radius. Provide radiusMiles (1-200) or radiusKm (1-400).',
        {
          code: 'INVALID_RADIUS',
        },
      )
    }

    const geo = await googleGeocodePostal(postalCode)

    if (geo.lat == null || geo.lng == null) {
      return jsonFail(400, 'Could not locate that postal code.', {
        code: 'POSTAL_NOT_FOUND',
      })
    }

    const timeZone = await googleTimeZone(geo.lat, geo.lng)
    const nameOverride = pickString(body.locationName)

    const effectivePostalCode = geo.postalCode || postalCode

    const addressPrivacyData = buildAddressPrivacyWriteData({
      formattedAddress: null,
      addressLine1: null,
      addressLine2: null,
      city: geo.city,
      state: geo.state,
      postalCode: effectivePostalCode,
      countryCode: geo.countryCode,
      placeId: null,
      lat: geo.lat,
      lng: geo.lng,
    })

    const created = await prisma.$transaction(async (tx) => {
      if (makePrimary) {
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

      const createdLocation = await tx.professionalLocation.create({
        data: {
          professionalId,
          type: ProfessionalLocationType.MOBILE_BASE,
          name: (nameOverride || 'Mobile base').trim() || 'Mobile base',
          isPrimary: makePrimary,

          // Onboarding creates a draft location only.
          // Publishing/bookability must go through /api/pro/schedule/publish.
          isBookable: false,

          city: geo.city,
          state: geo.state,
          postalCode: effectivePostalCode,
          countryCode: geo.countryCode,

          lat: geo.lat,
          lng: geo.lng,

          ...addressPrivacyData,

          timeZone,
          advanceNoticeMinutes,
          workingHours,
        },
        select: {
          id: true,
          type: true,
          timeZone: true,
          isPrimary: true,
          isBookable: true,
          advanceNoticeMinutes: true,
        },
      })

      await tx.professionalProfile.update({
        where: {
          id: professionalId,
        },
        data: {
          mobileBasePostalCode: effectivePostalCode,
          mobileRadiusMiles: radiusMiles,
          timeZone,
        },
        select: {
          id: true,
        },
      })

      return createdLocation
    })

    await syncDraftLocationSideEffects({
      professionalId,
      locationId: created.id,
    })

    return jsonOk({
      location: created,
    })
  } catch (error: unknown) {
    console.error('POST /api/pro/onboarding/location error', error)

    const message = error instanceof Error ? error.message : 'Internal error'

    return jsonFail(500, message, {
      code: 'INTERNAL',
    })
  }
}