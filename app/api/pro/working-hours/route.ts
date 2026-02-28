// app/api/pro/working-hours/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { Prisma, ProfessionalLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type LocationMode = 'SALON' | 'MOBILE'
type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

type WorkingHoursDay = { enabled: boolean; start: string; end: string }
type WorkingHoursObj = Record<WeekdayKey, WorkingHoursDay>

const DAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

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
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function normalizeMode(v: unknown): LocationMode {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function typesForMode(mode: LocationMode): ProfessionalLocationType[] {
  return mode === 'MOBILE'
    ? [ProfessionalLocationType.MOBILE_BASE]
    : [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function defaultWorkingHours(): WorkingHoursObj {
  const make = (enabled: boolean): WorkingHoursDay => ({ enabled, start: '09:00', end: '17:00' })
  return {
    mon: make(true),
    tue: make(true),
    wed: make(true),
    thu: make(true),
    fri: make(true),
    sat: make(false),
    sun: make(false),
  }
}

/** Accepts "9:00" and "09:00" and returns "HH:MM" */
function normalizeHHMM(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null

  const hh = Number(m[1])
  const mm = Number(m[2])

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null

  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function looksLikeWorkingHours(v: unknown): v is WorkingHoursObj {
  if (!isObject(v)) return false

  for (const d of DAYS) {
    const day = v[d]
    if (!isObject(day)) return false

    const enabled = day.enabled
    const start = day.start
    const end = day.end

    if (typeof enabled !== 'boolean') return false
    if (typeof start !== 'string' || typeof end !== 'string') return false
  }

  return true
}

function normalizeWorkingHours(raw: WorkingHoursObj): WorkingHoursObj {
  const fallback = defaultWorkingHours()
  const out: WorkingHoursObj = { ...fallback }

  for (const d of DAYS) {
    const src = raw[d]
    const start = normalizeHHMM(src?.start) ?? fallback[d].start
    const end = normalizeHHMM(src?.end) ?? fallback[d].end
    out[d] = { enabled: Boolean(src?.enabled), start, end }
  }

  return out
}

function safeHoursFromDb(raw: unknown): { hours: WorkingHoursObj; usedDefault: boolean } {
  if (looksLikeWorkingHours(raw)) return { hours: normalizeWorkingHours(raw), usedDefault: false }
  return { hours: defaultWorkingHours(), usedDefault: true }
}

/**
 * Prisma JSON fields want `Prisma.InputJsonValue`.
 * Our `WorkingHoursObj` is valid JSON (string/boolean/object), but TS doesn’t prove it.
 * Exception-with-receipts: one tight cast at the boundary.
 */
function toInputJsonValue(hours: WorkingHoursObj): Prisma.InputJsonValue {
  return hours as unknown as Prisma.InputJsonValue
}

/**
 * Pick a representative bookable location for a given mode.
 * - Try matching types for that mode (salon/suite OR mobile_base)
 * - Prefer primary, then oldest (stable)
 * - If none exist for that mode, fallback to ANY bookable location
 *
 * GET-only convenience; POST handles persistence.
 */
async function pickRepresentativeLocation(args: { professionalId: string; mode: LocationMode }) {
  const { professionalId, mode } = args
  const types = typesForMode(mode)

  const loc = await prisma.professionalLocation.findFirst({
    where: { professionalId, isBookable: true, type: { in: types } },
    select: { id: true, type: true, isPrimary: true, workingHours: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
  if (loc) return loc

  return prisma.professionalLocation.findFirst({
    where: { professionalId, isBookable: true },
    select: { id: true, type: true, isPrimary: true, workingHours: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
}

/**
 * Ensure at least one bookable location exists for the requested mode.
 * POST-only so we never create locations during GET.
 */
async function ensureBookableLocationForModeTx(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  mode: LocationMode
}) {
  const { tx, professionalId, mode } = args
  const types = typesForMode(mode)

  const existing = await tx.professionalLocation.findFirst({
    where: { professionalId, isBookable: true, type: { in: types } },
    select: { id: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
  if (existing) return existing.id

  const totalCount = await tx.professionalLocation.count({ where: { professionalId } })
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
    const mode = normalizeMode(searchParams.get('locationType'))

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
      location: { id: loc.id, type: loc.type, isPrimary: loc.isPrimary },
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
    const mode = normalizeMode(searchParams.get('locationType'))
    const types = typesForMode(mode)

    const body = (await req.json().catch(() => null)) as unknown
    if (!isObject(body)) return jsonFail(400, 'Invalid body.')

    const typedBody: PostBody = { workingHours: body.workingHours }
    const workingHoursRaw = typedBody.workingHours

    if (!looksLikeWorkingHours(workingHoursRaw)) {
      return jsonFail(400, 'workingHours must be an object with mon..sun: { enabled, start, end }.')
    }

    const normalized = normalizeWorkingHours(workingHoursRaw)

    const result = await prisma.$transaction(async (tx) => {
      await ensureBookableLocationForModeTx({ tx, professionalId, mode })

      const updated = await tx.professionalLocation.updateMany({
        where: { professionalId, isBookable: true, type: { in: types } },
        data: { workingHours: toInputJsonValue(normalized) },
      })

      if (updated.count === 0) {
        const all = await tx.professionalLocation.findMany({
          where: { professionalId },
          select: { id: true, type: true, isBookable: true, isPrimary: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          take: 50,
        })

        return {
          ok: false as const,
          debug: { mode, expectedTypes: types, locations: all },
        }
      }

      const updatedLocations = await tx.professionalLocation.findMany({
        where: { professionalId, isBookable: true, type: { in: types } },
        select: { id: true, type: true, isPrimary: true },
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
        'No bookable locations were updated. Check your location types / isBookable flags. (Server logged debug.)',
      )
    }

    const rep = result.updatedLocations[0] ?? null

    return jsonOk(
      {
        ok: true,
        locationType: mode,
        locationId: rep?.id ?? null,
        location: rep ? { id: rep.id, type: rep.type, isPrimary: rep.isPrimary } : null,
        workingHours: normalized,
        usedDefault: false,
        updatedCount: result.updatedCount,
        updatedLocationIds: result.updatedLocations.map((l) => l.id),
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/pro/working-hours error:', e)
    return jsonFail(500, 'Failed to save working hours.')
  }
}