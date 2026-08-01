// app/api/v1/waitlist/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString, requireClient } from '@/app/api/_utils'
import { bookingErrorJsonFail } from '@/app/api/_utils/bookingResponses'
import { cancelClientWaitlistEntry } from '@/lib/booking/writeBoundary'
import { isBookingError } from '@/lib/booking/errors'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { clientRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import {
  appendMessageToThread,
  broadcastThreadMessage,
} from '@/lib/messages/appendMessage'
import { resolveThreadCounterparty } from '@/lib/messages/counterparty'
import { messageThreadHref } from '@/lib/messages/notifyNewMessage'
import { resolveMessageThread } from '@/lib/messagesResolve'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { createProNotification } from '@/lib/notifications/proNotifications'
import {
  MessageThreadContextType,
  NotificationEventKey,
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
 * W2: tell the pro a client joined their waitlist.
 *
 * There was no notification for this at all — the seed message below wrote raw
 * Prisma rows and never went near the notification engine, so the pro's only
 * signal was an unread inbox dot, visible only while they were in the app. That
 * is exactly the reported "the only notifications I got were when I was signed
 * in as pro and on the app."
 *
 * ONE notification, not two. The seed message deliberately does NOT also fire
 * MESSAGE_RECEIVED: WAITLIST_JOINED is strictly richer for the same event
 * (in-app + push + EMAIL vs in-app + push) and opens the same thread, so
 * emitting both would just double-notify the pro about a single act.
 *
 * Deduped per waitlist ENTRY, so a client editing their preferences refreshes
 * the pro's existing row instead of stacking new ones.
 *
 * Best-effort: the waitlist join has already committed and must never be failed
 * by a notification problem.
 */
async function notifyWaitlistJoined(args: {
  professionalId: string
  clientId: string
  entryId: string
  threadId: string | null
  serviceName: string
  preferenceSummary: string
}): Promise<void> {
  try {
    const client = await prisma.clientProfile.findUnique({
      where: { id: args.clientId },
      select: { firstName: true, lastName: true, avatarUrl: true },
    })

    // Name resolution stays inside the shared counterparty helper — the same one
    // the inbox and MESSAGE_RECEIVED use — rather than reading the plaintext
    // name columns here. `viewerIsThreadPro: true` because the PRO is who reads
    // this notification, so the counterparty is the client.
    const { title: resolvedClientName } = resolveThreadCounterparty({
      viewerIsThreadPro: true,
      client,
      professional: null,
    })

    const clientName = resolvedClientName === 'Client' ? 'Someone' : resolvedClientName

    await createProNotification({
      professionalId: args.professionalId,
      eventKey: NotificationEventKey.WAITLIST_JOINED,
      title: `${clientName} joined your waitlist`,
      body: `${args.serviceName} · prefers ${args.preferenceSummary}. Offer them a time when one opens up.`,
      href: args.threadId ? messageThreadHref(args.threadId) : '/pro/waitlist',
      dedupeKey: `waitlist-joined:${args.entryId}`,
    })

    kickNotificationDrain()
  } catch (err) {
    console.error('POST /api/v1/waitlist: waitlist join notification failed', err)
  }
}

/**
 * Best-effort: materialize the WAITLIST message thread and seed it with one message so the
 * waitlister surfaces in the pro inbox (the inbox requires lastMessageAt != null). Failures
 * here must NEVER fail the waitlist join — they are swallowed and logged.
 *
 * Returns the thread id so the join notification can deep-link to it, and null
 * when seeding failed (the notification then falls back to /pro/waitlist rather
 * than not being sent at all).
 */
async function seedWaitlistThread(args: {
  clientId: string
  senderUserId: string
  entryId: string
  serviceId: string
  notes: string | null
  preferenceSummary: string
}): Promise<{ threadId: string; serviceName: string } | null> {
  try {
    const resolved = await resolveMessageThread({
      viewer: { clientProfile: { id: args.clientId } },
      input: {
        contextType: MessageThreadContextType.WAITLIST,
        contextId: args.entryId,
        createIfMissing: true,
      },
    })

    if (!resolved.ok || !resolved.thread) return null

    const threadId = resolved.thread.id
    const service = await prisma.service.findUnique({
      where: { id: args.serviceId },
      select: { name: true },
    })
    const serviceName = service?.name ?? 'this service'

    const body =
      `Joined your waitlist for ${serviceName}. Preferred: ${args.preferenceSummary}.` +
      (args.notes ? ` Notes: ${args.notes}` : '')

    // Appending a message is three writes, not one — the message, the thread's
    // inbox pointers, and the sender's own read receipt. Shared with the send
    // route so the inbox preview cannot drift between the two (it already had).
    await prisma.$transaction(async (tx) => {
      await appendMessageToThread({
        tx,
        threadId,
        senderUserId: args.senderUserId,
        body,
      })
    })

    // W2: the live-sync the send route does and this path never did, so a pro
    // with the inbox already open sees the waitlister appear instead of having
    // to reload. Not a notification — that is notifyWaitlistJoined's job.
    await broadcastThreadMessage({
      threadId,
      senderUserId: args.senderUserId,
    })

    return { threadId, serviceName }
  } catch (err) {
    console.error('POST /api/v1/waitlist: waitlist thread seed failed', err)
    // Swallow — the waitlist join already succeeded.
    return null
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

/**
 * One ceiling for join / edit / leave — see the `waitlist:write` comment in
 * `lib/rateLimit/policies.ts` for why the three share a bucket and why the key
 * is per-client. Enforced immediately after auth on every method, before any
 * DB read: the join's own duplicate check is itself two unrated queries.
 */
async function enforceWaitlistWriteLimit(args: {
  req: Request
  clientId: string
  userId: string
}): Promise<Response | null> {
  const decision = await enforceRateLimit({
    bucket: 'waitlist:write',
    key: clientRateLimitKey({
      clientId: args.clientId,
      userId: args.userId,
      request: args.req,
    }),
  })

  return decision.allowed ? null : rateLimitExceededResponse(decision)
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const limited = await enforceWaitlistWriteLimit({
      req,
      clientId: auth.clientId,
      userId: auth.user.id,
    })
    if (limited) return limited

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

    const preferenceSummary = formatWaitlistPreferenceSummary(parsedPreference)

    const seeded = await seedWaitlistThread({
      clientId: auth.clientId,
      senderUserId: auth.user.id,
      entryId: entry.id,
      serviceId,
      notes: notes ?? null,
      preferenceSummary,
    })

    // W2 — post-commit and best-effort, the same shape as the message send path.
    await notifyWaitlistJoined({
      professionalId,
      clientId: auth.clientId,
      entryId: entry.id,
      threadId: seeded?.threadId ?? null,
      serviceName: seeded?.serviceName ?? 'a service',
      preferenceSummary,
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

    const limited = await enforceWaitlistWriteLimit({
      req,
      clientId: auth.clientId,
      userId: auth.user.id,
    })
    if (limited) return limited

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

    const limited = await enforceWaitlistWriteLimit({
      req,
      clientId: auth.clientId,
      userId: auth.user.id,
    })
    if (limited) return limited

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

    // Through the write boundary, not a bare status update: leaving the
    // waitlist has to withdraw any outstanding offer and hand back the slot it
    // reserved, under the pro's schedule lock (B4). The checks above are a
    // fail-fast; the boundary re-runs them under that lock.
    await cancelClientWaitlistEntry({ entryId: id, clientId: auth.clientId })

    return jsonOk({}, 200)
  } catch (e) {
    // A status the pre-read missed (the client confirmed an offer in another
    // tab) surfaces as the boundary's own code rather than a 500.
    if (isBookingError(e)) return bookingErrorJsonFail(e)

    console.error('DELETE /api/v1/waitlist error', e)
    return jsonFail(500, 'Failed to remove waitlist.')
  }
}