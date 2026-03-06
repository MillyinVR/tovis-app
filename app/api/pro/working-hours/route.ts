// app/api/pro/working-hours/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { hhmmToMinutes, parseHHMM } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

type LocationMode = 'SALON' | 'MOBILE'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
type WeekdayKey = (typeof DAYS)[number]

type WorkingHoursDay = {
  enabled: boolean
  start: string
  end: string
}

type WorkingHoursObj = Record<WeekdayKey, WorkingHoursDay>

type GetResponse = {
  ok: true
  locationType: LocationMode
  locationId: string | null
  location: { id: string; type: ProfessionalLocationType; isPrimary: boolean } | null
  workingHours: WorkingHoursObj
  usedDefault: boolean
  missingLocation: boolean
}

type PostBody = {
  workingHours?: unknown
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function parseMode(v: unknown): LocationMode | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function typesForMode(mode: LocationMode): ProfessionalLocationType[] {
  return mode === 'MOBILE'
    ? [ProfessionalLocationType.MOBILE_BASE]
    : [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function defaultWorkingHours(): WorkingHoursObj {
  const weekday: WorkingHoursDay = { enabled: true, start: '09:00', end: '17:00' }
  const weekend: WorkingHoursDay = { enabled: false, start: '09:00', end: '17:00' }

  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { ...weekend },
    sun: { ...weekend },
  }
}

function normalizeHHMM(v: unknown): string | null {
  const parsed = parseHHMM(v)
  if (!parsed) return null
  return `${String(parsed.hh).padStart(2, '0')}:${String(parsed.mm).padStart(2, '0')}`
}

function isValidWorkingHoursDay(v: unknown): v is WorkingHoursDay {
  if (!isObject(v)) return false
  if (typeof v.enabled !== 'boolean') return false
  if (typeof v.start !== 'string' || typeof v.end !== 'string') return false

  const start = normalizeHHMM(v.start)
  const end = normalizeHHMM(v.end)
  if (!start || !end) return false

  const startMinutes = hhmmToMinutes(start)
  const endMinutes = hhmmToMinutes(end)
  if (startMinutes == null || endMinutes == null) return false

  return endMinutes > startMinutes
}

function looksLikeWorkingHours(v: unknown): v is WorkingHoursObj {
  if (!isObject(v)) return false

  for (const day of DAYS) {
    if (!isValidWorkingHoursDay(v[day])) return false
  }

  return true
}

function normalizeWorkingHours(raw: WorkingHoursObj): WorkingHoursObj {
  const normalizeDay = (day: WorkingHoursDay): WorkingHoursDay => {
    const start = normalizeHHMM(day.start)
    const end = normalizeHHMM(day.end)

    if (!start || !end) {
      throw new Error('INVALID_WORKING_HOURS')
    }

    const startMinutes = hhmmToMinutes(start)
    const endMinutes = hhmmToMinutes(end)

    if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
      throw new Error('INVALID_WORKING_HOURS')
    }

    return {
      enabled: day.enabled,
      start,
      end,
    }
  }

  return {
    mon: normalizeDay(raw.mon),
    tue: normalizeDay(raw.tue),
    wed: normalizeDay(raw.wed),
    thu: normalizeDay(raw.thu),
    fri: normalizeDay(raw.fri),
    sat: normalizeDay(raw.sat),
    sun: normalizeDay(raw.sun),
  }
}

function safeHoursFromDb(raw: unknown): { hours: WorkingHoursObj; usedDefault: boolean } {
  if (!looksLikeWorkingHours(raw)) {
    return { hours: defaultWorkingHours(), usedDefault: true }
  }

  try {
    return { hours: normalizeWorkingHours(raw), usedDefault: false }
  } catch {
    return { hours: defaultWorkingHours(), usedDefault: true }
  }
}

// Prisma JSON boundary cast: this object is plain JSON-safe data.
function toInputJsonValue(hours: WorkingHoursObj): Prisma.InputJsonValue {
  return hours as unknown as Prisma.InputJsonValue
}

async function pickRepresentativeLocation(args: { professionalId: string; mode: LocationMode }) {
  const { professionalId, mode } = args
  const types = typesForMode(mode)

  const matching = await prisma.professionalLocation.findFirst({
    where: {
      professionalId,
      isBookable: true,
      type: { in: types },
    },
    select: {
      id: true,
      type: true,
      isPrimary: true,
      workingHours: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })

  if (matching) return matching

  return prisma.professionalLocation.findFirst({
    where: {
      professionalId,
      isBookable: true,
    },
    select: {
      id: true,
      type: true,
      isPrimary: true,
      workingHours: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
}

async function ensureBookableLocationForModeTx(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  mode: LocationMode
}) {
  const { tx, professionalId, mode } = args
  const types = typesForMode(mode)

  const existing = await tx.professionalLocation.findFirst({
    where: {
      professionalId,
      isBookable: true,
      type: { in: types },
    },
    select: { id: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })

  if (existing) return existing.id

  const totalCount = await tx.professionalLocation.count({
    where: { professionalId },
  })

  const shouldBePrimary = totalCount === 0
  const createType =
    mode === 'MOBILE' ? ProfessionalLocationType.MOBILE_BASE : ProfessionalLocationType.SALON
  const name = mode === 'MOBILE' ? 'Mobile' : 'Salon'

  const created = await tx.professionalLocation.create({
    data: {
      professionalId,
      type: createType,
      name,
      isPrimary: shouldBePrimary,
      isBookable: true,
      timeZone: null,
      workingHours: toInputJsonValue(defaultWorkingHours()),
    },
    select: { id: true },
  })

  return created.id
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const { searchParams } = new URL(req.url)

    const mode = parseMode(searchParams.get('locationType')) ?? 'SALON'
    const loc = await pickRepresentativeLocation({ professionalId, mode })

    if (!loc) {
      const payload: GetResponse = {
        ok: true,
        locationType: mode,
        locationId: null,
        location: null,
        workingHours: defaultWorkingHours(),
        usedDefault: true,
        missingLocation: true,
      }
      return jsonOk(payload, 200)
    }

    const { hours, usedDefault } = safeHoursFromDb(loc.workingHours)

    const payload: GetResponse = {
      ok: true,
      locationType: mode,
      locationId: loc.id,
      location: {
        id: loc.id,
        type: loc.type,
        isPrimary: loc.isPrimary,
      },
      workingHours: hours,
      usedDefault,
      missingLocation: false,
    }

    return jsonOk(payload, 200)
  } catch (e) {
    console.error('GET /api/pro/working-hours error:', e)
    return jsonFail(500, 'Failed to load working hours.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const { searchParams } = new URL(req.url)

    const mode = parseMode(searchParams.get('locationType'))
    if (!mode) {
      return jsonFail(400, 'Missing or invalid locationType.')
    }

    const types = typesForMode(mode)

    const rawBody: unknown = await req.json().catch(() => null)
    if (!isObject(rawBody)) {
      return jsonFail(400, 'Invalid body.')
    }

    const body: PostBody = { workingHours: rawBody.workingHours }
    const workingHoursRaw = body.workingHours

    if (!looksLikeWorkingHours(workingHoursRaw)) {
      return jsonFail(
        400,
        'workingHours must contain mon..sun with { enabled, start, end }, valid HH:MM times, and end after start.',
      )
    }

    let normalized: WorkingHoursObj
    try {
      normalized = normalizeWorkingHours(workingHoursRaw)
    } catch {
      return jsonFail(
        400,
        'workingHours must contain mon..sun with { enabled, start, end }, valid HH:MM times, and end after start.',
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      await ensureBookableLocationForModeTx({ tx, professionalId, mode })

      const updated = await tx.professionalLocation.updateMany({
        where: {
          professionalId,
          isBookable: true,
          type: { in: types },
        },
        data: {
          workingHours: toInputJsonValue(normalized),
        },
      })

      if (updated.count === 0) {
        const allLocations = await tx.professionalLocation.findMany({
          where: { professionalId },
          select: {
            id: true,
            type: true,
            isBookable: true,
            isPrimary: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          take: 50,
        })

        return {
          ok: false as const,
          debug: {
            mode,
            expectedTypes: types,
            locations: allLocations,
          },
        }
      }

      const updatedLocations = await tx.professionalLocation.findMany({
        where: {
          professionalId,
          isBookable: true,
          type: { in: types },
        },
        select: {
          id: true,
          type: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 50,
      })

      return {
        ok: true as const,
        updatedCount: updated.count,
        updatedLocations,
      }
    })

    if (!result.ok) {
      console.error('POST /api/pro/working-hours updated 0 rows', result.debug)
      return jsonFail(
        409,
        'No bookable locations were updated. Check your location types and isBookable flags.',
      )
    }

    const representative = result.updatedLocations[0] ?? null

    return jsonOk(
      {
        ok: true,
        locationType: mode,
        locationId: representative?.id ?? null,
        location: representative
          ? {
              id: representative.id,
              type: representative.type,
              isPrimary: representative.isPrimary,
            }
          : null,
        workingHours: normalized,
        usedDefault: false,
        updatedCount: result.updatedCount,
        updatedLocationIds: result.updatedLocations.map((location) => location.id),
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/pro/working-hours error:', e)
    return jsonFail(500, 'Failed to save working hours.')
  }
}