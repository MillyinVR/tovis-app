// app/api/v1/waitlist/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString, requireClient } from '@/app/api/_utils'
import { resolveMessageThread } from '@/lib/messagesResolve'
import {
  MessageThreadContextType,
  WaitlistPreferenceType,
  WaitlistStatus,
  WaitlistTimeOfDay,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

function minutesToHhMm(min: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.trunc(min)))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Short human-readable summary of a waitlist preference for the seed message. */
function formatWaitlistPreferenceSummary(pref: {
  preferenceType: WaitlistPreferenceType
  specificDate: Date | null
  timeOfDay: WaitlistTimeOfDay | null
  windowStartMin: number | null
  windowEndMin: number | null
}): string {
  switch (pref.preferenceType) {
    case WaitlistPreferenceType.TIME_OF_DAY:
      return pref.timeOfDay ? pref.timeOfDay.toLowerCase() : 'any time'
    case WaitlistPreferenceType.SPECIFIC_DATE:
      return pref.specificDate
        ? pref.specificDate.toISOString().slice(0, 10)
        : 'a specific date'
    case WaitlistPreferenceType.TIME_RANGE:
      return pref.windowStartMin != null && pref.windowEndMin != null
        ? `${minutesToHhMm(pref.windowStartMin)}–${minutesToHhMm(pref.windowEndMin)}`
        : 'a time range'
    case WaitlistPreferenceType.ANY_TIME:
    default:
      return 'any time'
  }
}

/**
 * Best-effort: materialize the WAITLIST message thread and seed it with one message so the
 * waitlister surfaces in the pro inbox (the inbox requires lastMessageAt != null). Failures
 * here must NEVER fail the waitlist join — they are swallowed and logged.
 */
async function seedWaitlistThread(args: {
  clientId: string
  senderUserId: string
  entryId: string
  serviceId: string
  notes: string | null
  preferenceSummary: string
}): Promise<void> {
  try {
    const resolved = await resolveMessageThread({
      viewer: { clientProfile: { id: args.clientId } },
      input: {
        contextType: MessageThreadContextType.WAITLIST,
        contextId: args.entryId,
        createIfMissing: true,
      },
    })

    if (!resolved.ok || !resolved.thread) return

    const threadId = resolved.thread.id
    const service = await prisma.service.findUnique({
      where: { id: args.serviceId },
      select: { name: true },
    })
    const serviceName = service?.name ?? 'this service'

    const body =
      `Joined your waitlist for ${serviceName}. Preferred: ${args.preferenceSummary}.` +
      (args.notes ? ` Notes: ${args.notes}` : '')

    await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: { threadId, senderUserId: args.senderUserId, body },
        select: { id: true, createdAt: true },
      })
      await tx.messageThread.update({
        where: { id: threadId },
        data: { lastMessageAt: msg.createdAt, lastMessagePreview: body.slice(0, 140) },
      })
      await tx.messageThreadParticipant.update({
        where: { threadId_userId: { threadId, userId: args.senderUserId } },
        data: { lastReadAt: msg.createdAt },
      })
    })
  } catch (err) {
    console.error('POST /api/v1/waitlist: waitlist thread seed failed', err)
    // Swallow — the waitlist join already succeeded.
  }
}

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

    await seedWaitlistThread({
      clientId: auth.clientId,
      senderUserId: auth.user.id,
      entryId: entry.id,
      serviceId,
      notes: notes ?? null,
      preferenceSummary: formatWaitlistPreferenceSummary(parsedPreference),
    })

    return jsonOk({ entry }, 201)
  } catch (e) {
    console.error('POST /api/v1/waitlist error', e)
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
    console.error('PATCH /api/v1/waitlist error', e)
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
    console.error('DELETE /api/v1/waitlist error', e)
    return jsonFail(500, 'Failed to remove waitlist.')
  }
}