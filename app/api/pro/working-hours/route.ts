// app/api/pro/working-hours/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import type { ProfessionalLocationType, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type LocationMode = 'SALON' | 'MOBILE'
type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

type WorkingHoursDay = { enabled: boolean; start: string; end: string }
type WorkingHoursObj = Record<WeekdayKey, WorkingHoursDay>

const DAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function normalizeMode(v: unknown): LocationMode {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function typesForMode(mode: LocationMode): ProfessionalLocationType[] {
  return mode === 'MOBILE' ? (['MOBILE_BASE'] as const) : (['SALON', 'SUITE'] as const)
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
    const day = (v as any)[d]
    if (!isObject(day)) return false
    if (typeof day.enabled !== 'boolean') return false
    if (typeof day.start !== 'string' || typeof day.end !== 'string') return false
  }
  return true
}

function normalizeWorkingHours(raw: WorkingHoursObj): WorkingHoursObj {
  const fallback = defaultWorkingHours()
  const out = { ...fallback } as WorkingHoursObj

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
 * Pick a representative bookable location for a given mode.
 * - First try matching types for that mode (salon/suite OR mobile_base)
 * - Prefer primary, then oldest (stable)
 * - If none exist for that mode, fallback to ANY bookable location
 *
 * NOTE: This is only used for GET responses and UI overlays.
 * Saving behavior is handled separately (POST) and updates all matching bookable locations.
 */
async function pickRepresentativeLocation(args: { professionalId: string; mode: LocationMode }) {
  const { professionalId, mode } = args
  const types = typesForMode(mode)

  const loc = await prisma.professionalLocation.findFirst({
    where: { professionalId, isBookable: true, type: { in: types as any } },
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
 * We do NOT want to silently create locations during GET.
 * This is POST-only so saving hours never "updates 0 rows" due to missing locations.
 */
async function ensureBookableLocationForModeTx(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  mode: LocationMode
}) {
  const { tx, professionalId, mode } = args
  const types = typesForMode(mode)

  const existing = await tx.professionalLocation.findFirst({
    where: { professionalId, isBookable: true, type: { in: types as any } },
    select: { id: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
  if (existing) return existing.id

  const totalCount = await tx.professionalLocation.count({ where: { professionalId } })
  const shouldBePrimary = totalCount === 0

  const createType: ProfessionalLocationType = mode === 'MOBILE' ? 'MOBILE_BASE' : 'SALON'
  const name = mode === 'MOBILE' ? 'Mobile' : 'Salon'

  const created = await tx.professionalLocation.create({
    data: {
      professionalId,
      type: createType,
      name,
      isPrimary: shouldBePrimary,
      isBookable: true,
      timeZone: null,
      workingHours: defaultWorkingHours() as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  })

  return created.id
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const { searchParams } = new URL(req.url)
    const mode = normalizeMode(searchParams.get('locationType'))

    const loc = await pickRepresentativeLocation({ professionalId, mode })

    // If they literally have no bookable location at all, return defaults
    // and make it explicit to the UI that this is a placeholder.
    if (!loc) {
      return jsonOk(
        {
          ok: true,
          locationType: mode,
          locationId: null,
          location: null,
          workingHours: defaultWorkingHours(),
          usedDefault: true,
          missingLocation: true,
        },
        200,
      )
    }

    const { hours, usedDefault } = safeHoursFromDb(loc.workingHours)

    return jsonOk(
      {
        ok: true,
        locationType: mode,
        locationId: loc.id,
        location: { id: loc.id, type: loc.type, isPrimary: loc.isPrimary },
        workingHours: hours,
        usedDefault,
        missingLocation: false,
      },
      200,
    )
  } catch (e: any) {
    console.error('GET /api/pro/working-hours error:', e)
    return jsonFail(500, 'Failed to load working hours.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const { searchParams } = new URL(req.url)
    const mode = normalizeMode(searchParams.get('locationType'))
    const types = typesForMode(mode)

    const body = await req.json().catch(() => null)
    if (!isObject(body)) return jsonFail(400, 'Invalid body')

    const workingHoursRaw = (body as any).workingHours
    if (!looksLikeWorkingHours(workingHoursRaw)) {
      return jsonFail(400, 'workingHours must be an object with mon..sun: { enabled, start, end }')
    }

    const normalized = normalizeWorkingHours(workingHoursRaw)

    const result = await prisma.$transaction(async (tx) => {
      // ✅ Make sure the mode has at least one bookable location
      await ensureBookableLocationForModeTx({ tx, professionalId, mode })

      // ✅ Update ALL bookable locations that match the mode types
      const updated = await tx.professionalLocation.updateMany({
        where: { professionalId, isBookable: true, type: { in: types as any } },
        data: { workingHours: normalized as unknown as Prisma.InputJsonValue },
      })

      // If we updated nothing, we want rich debug (because it means your location data is misconfigured).
      if (updated.count === 0) {
        const all = await tx.professionalLocation.findMany({
          where: { professionalId },
          select: { id: true, type: true, isBookable: true, isPrimary: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          take: 50,
        })

        return {
          ok: false as const,
          updatedCount: 0,
          debug: { mode, expectedTypes: types, locations: all },
        }
      }

      const updatedLocations = await tx.professionalLocation.findMany({
        where: { professionalId, isBookable: true, type: { in: types as any } },
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
  } catch (e: any) {
    console.error('POST /api/pro/working-hours error:', e)
    return jsonFail(500, 'Failed to save working hours.')
  }
}
