// app/api/waitlist/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString, requireClient } from '@/app/api/_utils'
import { WaitlistStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function toISODateOrNull(v: unknown): Date | null {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === 'number' ? v : pickInt(v)
  if (!Number.isFinite(Number(n))) return fallback
  return Math.max(min, Math.min(max, Math.floor(Number(n))))
}

type PreferredWindow =
  | { ok: true; start: Date; end: Date }
  | { ok: false; error: string }

/**
 * Accept either:
 * A) preferredStart + preferredEnd
 * B) desiredFor + flexibilityMinutes -> window derived
 */
function parsePreferredWindow(body: unknown): PreferredWindow {
  if (!isObject(body)) return { ok: false, error: 'Invalid body.' }

  const preferredStart = toISODateOrNull(body.preferredStart)
  const preferredEnd = toISODateOrNull(body.preferredEnd)

  const desiredFor = toISODateOrNull(body.desiredFor)
  const flexibilityMinutes = clampInt(body.flexibilityMinutes, 15, 24 * 60, 60)

  let start: Date | null = preferredStart
  let end: Date | null = preferredEnd

  if (!start || !end) {
    if (!desiredFor) {
      return { ok: false, error: 'Provide preferredStart/preferredEnd OR desiredFor + flexibilityMinutes.' }
    }
    start = new Date(desiredFor.getTime() - flexibilityMinutes * 60_000)
    end = new Date(desiredFor.getTime() + flexibilityMinutes * 60_000)
  }

  if (end <= start) return { ok: false, error: 'preferredEnd must be after preferredStart.' }
  return { ok: true, start, end }
}

async function validateMediaBelongsToPro(args: { mediaId: string; professionalId: string }) {
  const { mediaId, professionalId } = args
  const m = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: { id: true, professionalId: true },
  })
  if (!m) return { ok: false as const, error: 'mediaId not found.' }
  if (m.professionalId !== professionalId) {
    return { ok: false as const, error: 'mediaId does not belong to this professional.' }
  }
  return { ok: true as const }
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body = await req.json().catch(() => ({}))

    const professionalId = pickString(isObject(body) ? body.professionalId : null)
    const serviceId = pickString(isObject(body) ? body.serviceId : null)
    const mediaId = pickString(isObject(body) ? body.mediaId : null)
    const preferredTimeBucket = pickString(isObject(body) ? body.preferredTimeBucket : null)
    const notes = pickString(isObject(body) ? body.notes : null)

    if (!professionalId) return jsonFail(400, 'Missing professionalId.')
    if (!serviceId) return jsonFail(400, 'Missing serviceId.')

    const window = parsePreferredWindow(body)
    if (!window.ok) return jsonFail(400, window.error)

    if (mediaId) {
      const mediaCheck = await validateMediaBelongsToPro({ mediaId, professionalId })
      if (!mediaCheck.ok) return jsonFail(400, mediaCheck.error)
    }

    // Treat NOTIFIED as still “active-ish” so they can’t spam duplicates
    const existing = await prisma.waitlistEntry.findFirst({
      where: {
        clientId: auth.clientId,
        professionalId,
        serviceId,
        status: { in: [WaitlistStatus.ACTIVE, WaitlistStatus.NOTIFIED] },
      },
      select: { id: true },
    })
    if (existing) return jsonFail(409, 'You already have an active waitlist request for this pro/service.')

    const entry = await prisma.waitlistEntry.create({
      data: {
        clientId: auth.clientId,
        professionalId,
        serviceId,
        mediaId: mediaId ?? null,
        notes: notes ?? null,
        preferredStart: window.start,
        preferredEnd: window.end,
        preferredTimeBucket: preferredTimeBucket ?? null,
        status: WaitlistStatus.ACTIVE,
      },
      select: {
        id: true,
        status: true,
        professionalId: true,
        serviceId: true,
        mediaId: true,
        preferredStart: true,
        preferredEnd: true,
        preferredTimeBucket: true,
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

    const body = await req.json().catch(() => ({}))
    const id = pickString(isObject(body) ? body.id : null)
    if (!id) return jsonFail(400, 'Missing id.')

    const existing = await prisma.waitlistEntry.findUnique({
      where: { id },
      select: { id: true, clientId: true, professionalId: true, status: true },
    })
    if (!existing) return jsonFail(404, 'Waitlist entry not found.')
    if (existing.clientId !== auth.clientId) return jsonFail(403, 'Forbidden.')

    // No silent reactivation
    if (existing.status === WaitlistStatus.CANCELLED) return jsonFail(409, 'This waitlist entry is cancelled.')
    if (existing.status === WaitlistStatus.BOOKED) return jsonFail(409, 'This waitlist entry is already booked.')

    const window = parsePreferredWindow(body)
    if (!window.ok) return jsonFail(400, window.error)

    const preferredTimeBucket = pickString(isObject(body) ? body.preferredTimeBucket : null)
    const notes = pickString(isObject(body) ? body.notes : null)
    const mediaId = pickString(isObject(body) ? body.mediaId : null)

    if (mediaId) {
      const mediaCheck = await validateMediaBelongsToPro({ mediaId, professionalId: existing.professionalId })
      if (!mediaCheck.ok) return jsonFail(400, mediaCheck.error)
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id },
      data: {
        preferredStart: window.start,
        preferredEnd: window.end,
        preferredTimeBucket: preferredTimeBucket ?? null,
        notes: notes ?? null,
        mediaId: mediaId ?? null,
        // status intentionally unchanged on PATCH
      },
      select: {
        id: true,
        status: true,
        professionalId: true,
        serviceId: true,
        mediaId: true,
        preferredStart: true,
        preferredEnd: true,
        preferredTimeBucket: true,
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

    // Idempotent delete
    if (!existing) return jsonOk({}, 200)
    if (existing.clientId !== auth.clientId) return jsonFail(403, 'Forbidden.')

    // If already cancelled, keep it idempotent
    if (existing.status === WaitlistStatus.CANCELLED) return jsonOk({}, 200)
    if (existing.status === WaitlistStatus.BOOKED) return jsonFail(409, 'This waitlist entry is already booked.')

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