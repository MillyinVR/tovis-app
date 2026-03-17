// app/api/waitlist/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString, requireClient } from '@/app/api/_utils'
import {
  WaitlistPreferenceType,
  WaitlistStatus,
  WaitlistTimeOfDay,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function parseSpecificDate(v: unknown): Date | null {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function parsePreferenceType(v: unknown): WaitlistPreferenceType | null {
  if (v === WaitlistPreferenceType.ANY_TIME) return WaitlistPreferenceType.ANY_TIME
  if (v === WaitlistPreferenceType.TIME_OF_DAY) return WaitlistPreferenceType.TIME_OF_DAY
  if (v === WaitlistPreferenceType.SPECIFIC_DATE) return WaitlistPreferenceType.SPECIFIC_DATE
  if (v === WaitlistPreferenceType.TIME_RANGE) return WaitlistPreferenceType.TIME_RANGE
  return null
}

function parseTimeOfDay(v: unknown): WaitlistTimeOfDay | null {
  if (v === WaitlistTimeOfDay.MORNING) return WaitlistTimeOfDay.MORNING
  if (v === WaitlistTimeOfDay.AFTERNOON) return WaitlistTimeOfDay.AFTERNOON
  if (v === WaitlistTimeOfDay.EVENING) return WaitlistTimeOfDay.EVENING
  return null
}

function parseMinuteOfDay(v: unknown): number | null {
  const n = pickInt(v)
  if (n == null) return null
  if (!Number.isInteger(n)) return null
  if (n < 0 || n > 1440) return null
  return n
}

type ParsedPreference =
  | {
      ok: true
      preferenceType: WaitlistPreferenceType
      specificDate: Date | null
      timeOfDay: WaitlistTimeOfDay | null
      windowStartMin: number | null
      windowEndMin: number | null
    }
  | { ok: false; error: string }

function parsePreference(body: unknown): ParsedPreference {
  if (!isObject(body)) return { ok: false, error: 'Invalid body.' }

  const preferenceType = parsePreferenceType(body.preferenceType)
  if (!preferenceType) {
    return { ok: false, error: 'Invalid preferenceType.' }
  }

  if (preferenceType === WaitlistPreferenceType.ANY_TIME) {
    return {
      ok: true,
      preferenceType,
      specificDate: null,
      timeOfDay: null,
      windowStartMin: null,
      windowEndMin: null,
    }
  }

  if (preferenceType === WaitlistPreferenceType.TIME_OF_DAY) {
    const timeOfDay = parseTimeOfDay(body.timeOfDay)
    if (!timeOfDay) {
      return { ok: false, error: 'timeOfDay is required for TIME_OF_DAY.' }
    }

    return {
      ok: true,
      preferenceType,
      specificDate: null,
      timeOfDay,
      windowStartMin: null,
      windowEndMin: null,
    }
  }

  if (preferenceType === WaitlistPreferenceType.SPECIFIC_DATE) {
    const specificDate = parseSpecificDate(body.specificDate)
    if (!specificDate) {
      return { ok: false, error: 'specificDate is required for SPECIFIC_DATE.' }
    }

    return {
      ok: true,
      preferenceType,
      specificDate,
      timeOfDay: null,
      windowStartMin: null,
      windowEndMin: null,
    }
  }

  const windowStartMin = parseMinuteOfDay(body.windowStartMin)
  const windowEndMin = parseMinuteOfDay(body.windowEndMin)

  if (windowStartMin == null || windowEndMin == null) {
    return {
      ok: false,
      error: 'windowStartMin and windowEndMin are required for TIME_RANGE.',
    }
  }

  if (windowStartMin >= windowEndMin) {
    return {
      ok: false,
      error: 'windowEndMin must be greater than windowStartMin.',
    }
  }

  return {
    ok: true,
    preferenceType,
    specificDate: null,
    timeOfDay: null,
    windowStartMin,
    windowEndMin,
  }
}
type MediaOwnershipCheck =
  | { ok: true }
  | { ok: false; error: string }

async function validateMediaBelongsToPro(args: {
  mediaId: string
  professionalId: string
}): Promise<MediaOwnershipCheck> {
  const { mediaId, professionalId } = args

  const media = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: { id: true, professionalId: true },
  })

  if (!media) return { ok: false, error: 'mediaId not found.' }
  if (media.professionalId !== professionalId) {
    return { ok: false, error: 'mediaId does not belong to this professional.' }
  }

  return { ok: true }
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body: unknown = await req.json().catch(() => ({}))
    if (!isObject(body)) return jsonFail(400, 'Invalid body.')

    const professionalId = pickString(body.professionalId)
    const serviceId = pickString(body.serviceId)
    const mediaId = pickString(body.mediaId)
    const notes = pickString(body.notes)

    if (!professionalId) return jsonFail(400, 'Missing professionalId.')
    if (!serviceId) return jsonFail(400, 'Missing serviceId.')

    const parsedPreference = parsePreference(body)
    if (!parsedPreference.ok) return jsonFail(400, parsedPreference.error)

    if (mediaId) {
      const mediaCheck = await validateMediaBelongsToPro({ mediaId, professionalId })
      if (!mediaCheck.ok) return jsonFail(400, mediaCheck.error)
    }

    const existing = await prisma.waitlistEntry.findFirst({
      where: {
        clientId: auth.clientId,
        professionalId,
        serviceId,
        status: { in: [WaitlistStatus.ACTIVE, WaitlistStatus.NOTIFIED] },
      },
      select: { id: true },
    })

    if (existing) {
      return jsonFail(409, 'You already have an active waitlist request for this pro/service.')
    }

    const entry = await prisma.waitlistEntry.create({
      data: {
        clientId: auth.clientId,
        professionalId,
        serviceId,
        mediaId: mediaId ?? null,
        notes: notes ?? null,
        preferenceType: parsedPreference.preferenceType,
        specificDate: parsedPreference.specificDate,
        timeOfDay: parsedPreference.timeOfDay,
        windowStartMin: parsedPreference.windowStartMin,
        windowEndMin: parsedPreference.windowEndMin,
        status: WaitlistStatus.ACTIVE,
      },
      select: {
        id: true,
        status: true,
        professionalId: true,
        serviceId: true,
        mediaId: true,
        notes: true,
        preferenceType: true,
        specificDate: true,
        timeOfDay: true,
        windowStartMin: true,
        windowEndMin: true,
      },
    })

    return jsonOk({ entry }, 201)
  } catch (e) {
    console.error('POST /api/waitlist error', e)
    return jsonFail(500, 'Failed to join waitlist.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body: unknown = await req.json().catch(() => ({}))
    if (!isObject(body)) return jsonFail(400, 'Invalid body.')

    const id = pickString(body.id)
    if (!id) return jsonFail(400, 'Missing id.')

    const existing = await prisma.waitlistEntry.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        serviceId: true,
        status: true,
      },
    })

    if (!existing) return jsonFail(404, 'Waitlist entry not found.')
    if (existing.clientId !== auth.clientId) return jsonFail(403, 'Forbidden.')

    if (existing.status === WaitlistStatus.CANCELLED) {
      return jsonFail(409, 'This waitlist entry is cancelled.')
    }
    if (existing.status === WaitlistStatus.BOOKED) {
      return jsonFail(409, 'This waitlist entry is already booked.')
    }

    const parsedPreference = parsePreference(body)
    if (!parsedPreference.ok) return jsonFail(400, parsedPreference.error)

    const notes = pickString(body.notes)
    const mediaId = pickString(body.mediaId)

    if (mediaId) {
      const mediaCheck = await validateMediaBelongsToPro({
        mediaId,
        professionalId: existing.professionalId,
      })
      if (!mediaCheck.ok) return jsonFail(400, mediaCheck.error)
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id },
      data: {
        notes: notes ?? null,
        mediaId: mediaId ?? null,
        preferenceType: parsedPreference.preferenceType,
        specificDate: parsedPreference.specificDate,
        timeOfDay: parsedPreference.timeOfDay,
        windowStartMin: parsedPreference.windowStartMin,
        windowEndMin: parsedPreference.windowEndMin,
      },
      select: {
        id: true,
        status: true,
        professionalId: true,
        serviceId: true,
        mediaId: true,
        notes: true,
        preferenceType: true,
        specificDate: true,
        timeOfDay: true,
        windowStartMin: true,
        windowEndMin: true,
      },
    })

    return jsonOk({ entry: updated }, 200)
  } catch (e) {
    console.error('PATCH /api/waitlist error', e)
    return jsonFail(500, 'Failed to update waitlist.')
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { searchParams } = new URL(req.url)
    const id = pickString(searchParams.get('id'))
    if (!id) return jsonFail(400, 'Missing id.')

    const existing = await prisma.waitlistEntry.findUnique({
      where: { id },
      select: { id: true, clientId: true, status: true },
    })

    if (!existing) return jsonOk({}, 200)
    if (existing.clientId !== auth.clientId) return jsonFail(403, 'Forbidden.')

    if (existing.status === WaitlistStatus.CANCELLED) return jsonOk({}, 200)
    if (existing.status === WaitlistStatus.BOOKED) {
      return jsonFail(409, 'This waitlist entry is already booked.')
    }

    await prisma.waitlistEntry.update({
      where: { id },
      data: { status: WaitlistStatus.CANCELLED },
      select: { id: true },
    })

    return jsonOk({}, 200)
  } catch (e) {
    console.error('DELETE /api/waitlist error', e)
    return jsonFail(500, 'Failed to remove waitlist.')
  }
}