// app/api/pro/locations/route.ts

import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { pickString } from '@/app/api/_utils/pick'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { bumpScheduleConfigVersion } from '@/lib/booking/cacheVersion'
import { hasOwn, isRecord, type UnknownRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import {
  PROFESSIONAL_LOCATION_SELECT,
  buildProfessionalLocationAddressPrivacyInput,
  buildProfessionalLocationLegacyAddressData,
  buildProfessionalLocationScheduleCreateData,
  mapProfessionalLocation,
  normalizeProfessionalLocationType,
  parseProfessionalLocationAddressInput,
  parseProfessionalLocationScheduleInput,
  validateBookableProfessionalLocation,
} from '@/lib/proLocations/locationInput'
import { refreshLocation } from '@/lib/search/index/refreshSearchIndex'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'

export const dynamic = 'force-dynamic'

async function loadProfessionalLocations(professionalId: string) {
  const locations = await prisma.professionalLocation.findMany({
    where: { professionalId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: PROFESSIONAL_LOCATION_SELECT,
    take: 100,
  })

  return locations.map(mapProfessionalLocation)
}

function readOptionalBoolean(
  body: UnknownRecord,
  key: string,
): boolean | undefined | 'invalid' {
  if (!hasOwn(body, key)) return undefined

  const value = body[key]
  if (typeof value === 'boolean') return value

  return 'invalid'
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const locations = await loadProfessionalLocations(auth.professionalId)

    return jsonOk({ locations })
  } catch (error) {
    console.error('GET /api/pro/locations error', error)
    return jsonFail(500, 'Failed to load locations')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const limited = await enforceRateLimit({
      bucket: 'pro:locations:write',
      identity: await rateLimitIdentity(auth.userId),
    })

    if (limited) return limited

    const raw: unknown = await req.json().catch(() => ({}))
    const body: UnknownRecord = isRecord(raw) ? raw : {}

    const type = normalizeProfessionalLocationType(body.type)
    if (!type) {
      return jsonFail(400, 'Missing/invalid type.')
    }

    const name = hasOwn(body, 'name') ? pickString(body.name) : null

    const isBookable = readOptionalBoolean(body, 'isBookable')
    if (isBookable === 'invalid') {
      return jsonFail(400, 'isBookable must be boolean.')
    }

    const wantsPrimary = readOptionalBoolean(body, 'isPrimary')
    if (wantsPrimary === 'invalid') {
      return jsonFail(400, 'isPrimary must be boolean.')
    }

    const parsedAddress = parseProfessionalLocationAddressInput(body)
    if (!parsedAddress.ok) {
      return jsonFail(400, parsedAddress.error)
    }

    const parsedSchedule = parseProfessionalLocationScheduleInput(body)
    if (!parsedSchedule.ok) {
      return jsonFail(400, parsedSchedule.error)
    }

    const address = parsedAddress.value
    const schedule = parsedSchedule.value
    const willBookable = typeof isBookable === 'boolean' ? isBookable : false

    if (willBookable) {
      const validationError = validateBookableProfessionalLocation({
        type,
        timeZone: schedule.timeZone,
        address,
      })

      if (validationError) {
        return jsonFail(400, validationError)
      }
    }

    const addressPrivacyData = buildAddressPrivacyWriteData(
      buildProfessionalLocationAddressPrivacyInput(address),
    )

    const created = await prisma.$transaction(async (tx) => {
      const existingCount = await tx.professionalLocation.count({
        where: { professionalId },
      })

      const isFirst = existingCount === 0
      const willPrimary = isFirst ? true : Boolean(wantsPrimary)

      if (willPrimary) {
        await tx.professionalLocation.updateMany({
          where: { professionalId, isPrimary: true },
          data: { isPrimary: false },
        })
      }

      return tx.professionalLocation.create({
        data: {
          professionalId,
          type,
          name,

          isPrimary: willPrimary,
          isBookable: willBookable,

          // Keep legacy/public columns in sync for current read compatibility.
          // The encrypted/search-safe fields below are the privacy boundary.
          ...buildProfessionalLocationLegacyAddressData(address),
          ...addressPrivacyData,
          ...buildProfessionalLocationScheduleCreateData(schedule),
        },
        select: PROFESSIONAL_LOCATION_SELECT,
      })
    })

    await bumpScheduleConfigVersion(professionalId)
    await refreshLocation(created.id, 'location.create')

    return jsonOk(
      {
        location: mapProfessionalLocation(created),
      },
      201,
    )
  } catch (error) {
    console.error('POST /api/pro/locations error', error)
    return jsonFail(500, 'Failed to create location')
  }
}