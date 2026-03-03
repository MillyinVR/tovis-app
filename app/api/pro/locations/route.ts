// app/api/pro/locations/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

const DEFAULT_WORKING_HOURS: Prisma.JsonObject = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: false, start: '09:00', end: '17:00' },
  sun: { enabled: false, start: '09:00', end: '17:00' },
}

type JsonObject = Record<string, unknown>

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function readJsonObject(req: Request): Promise<JsonObject> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function pickStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

function pickBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function pickNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function normalizeProfessionalLocationType(v: unknown): ProfessionalLocationType | null {
  const s = upper(v)
  if (s === 'SALON') return ProfessionalLocationType.SALON
  if (s === 'SUITE') return ProfessionalLocationType.SUITE
  if (s === 'MOBILE_BASE') return ProfessionalLocationType.MOBILE_BASE
  return null
}

function requireAddressForType(t: ProfessionalLocationType) {
  return t === ProfessionalLocationType.SALON || t === ProfessionalLocationType.SUITE
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const locations = await prisma.professionalLocation.findMany({
      where: { professionalId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        type: true,
        name: true,
        isPrimary: true,
        isBookable: true,

        formattedAddress: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        countryCode: true,
        placeId: true,

        lat: true,
        lng: true,

        timeZone: true,
        workingHours: true,

        bufferMinutes: true,
        stepMinutes: true,
        advanceNoticeMinutes: true,
        maxDaysAhead: true,

        createdAt: true,
        updatedAt: true,
      },
      take: 100,
    })

    return jsonOk({
      locations: locations.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
      })),
    })
  } catch (e) {
    console.error('GET /api/pro/locations error', e)
    return jsonFail(500, 'Failed to load locations')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = await readJsonObject(req)

    const type = normalizeProfessionalLocationType(body.type)
    if (!type) return jsonFail(400, 'Missing/invalid type.')

    const name = pickStringOrNull(body.name)
    const isPrimary = pickBool(body.isPrimary) ?? false
    const isBookable = pickBool(body.isBookable) ?? true

    const formattedAddress = pickStringOrNull(body.formattedAddress)
    const addressLine1 = pickStringOrNull(body.addressLine1)
    const addressLine2 = pickStringOrNull(body.addressLine2)
    const city = pickStringOrNull(body.city)
    const state = pickStringOrNull(body.state)
    const postalCode = pickStringOrNull(body.postalCode)
    const countryCode = pickStringOrNull(body.countryCode)
    const placeId = pickStringOrNull(body.placeId)

    const lat = pickNumber(body.lat)
    const lng = pickNumber(body.lng)

    const timeZone = pickStringOrNull(body.timeZone)

    // Address rules
    if (requireAddressForType(type)) {
      if (!placeId || !formattedAddress || lat == null || lng == null) {
        return jsonFail(400, 'Salon/Suite locations require an address (placeId + formattedAddress + lat/lng).')
      }
    }

    // Timezone rules: if it’s bookable, timezone must be valid.
    if (isBookable) {
      if (!timeZone || !isValidIanaTimeZone(timeZone)) {
        return jsonFail(400, 'Bookable locations must have a valid IANA timeZone (e.g. America/Los_Angeles).')
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.professionalLocation.updateMany({
          where: { professionalId },
          data: { isPrimary: false },
        })
      }

      return tx.professionalLocation.create({
        data: {
          professionalId,
          type,
          name,
          isPrimary,
          isBookable,

          formattedAddress,
          addressLine1,
          addressLine2,
          city,
          state,
          postalCode,
          countryCode,
          placeId,

          lat: lat == null ? null : new Prisma.Decimal(lat),
          lng: lng == null ? null : new Prisma.Decimal(lng),

          timeZone: timeZone ?? null,

          // required Json field — never null
          workingHours: DEFAULT_WORKING_HOURS,
        },
        select: { id: true },
      })
    })

    return jsonOk({ id: created.id }, 201)
  } catch (e) {
    console.error('POST /api/pro/locations error', e)
    return jsonFail(500, 'Failed to create location')
  }
}