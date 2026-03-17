// app/api/pro/working-hours/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { ProfessionalLocationType } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import {
  defaultWorkingHours,
  normalizeWorkingHours,
  toInputJsonValue,
  type WorkingHoursObj,
} from '@/lib/scheduling/workingHoursValidation'

export const dynamic = 'force-dynamic'

type LocationMode = 'SALON' | 'MOBILE'

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

function modeLabel(mode: LocationMode): string {
  return mode === 'MOBILE' ? 'mobile' : 'salon/suite'
}

async function pickRepresentativeLocation(args: {
  professionalId: string
  mode: LocationMode
}) {
  const { professionalId, mode } = args
  const types = typesForMode(mode)

  return prisma.professionalLocation.findFirst({
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
}

async function findMatchingBookableLocations(args: {
  professionalId: string
  mode: LocationMode
}) {
  const { professionalId, mode } = args
  const types = typesForMode(mode)

  return prisma.professionalLocation.findMany({
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

    const normalizedFromDb = normalizeWorkingHours(loc.workingHours)
    const hours = normalizedFromDb ?? defaultWorkingHours()
    const usedDefault = normalizedFromDb == null

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

    const rawBody: unknown = await req.json().catch(() => null)
    if (!isRecord(rawBody)) {
      return jsonFail(400, 'Invalid body.')
    }

    const body: PostBody = { workingHours: rawBody.workingHours }
    const normalized = normalizeWorkingHours(body.workingHours)

    if (!normalized) {
      return jsonFail(
        400,
        'workingHours must contain mon..sun with { enabled, start, end } and valid HH:MM times. Overnight ranges are allowed.',
      )
    }

    const matchingLocations = await findMatchingBookableLocations({
      professionalId,
      mode,
    })

    if (matchingLocations.length === 0) {
      return jsonFail(
        409,
        `No bookable ${modeLabel(mode)} location exists yet. Create and finish a bookable location first, then save working hours.`,
      )
    }

    const types = typesForMode(mode)

    const result = await prisma.$transaction(async (tx) => {
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
        return { ok: false as const }
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