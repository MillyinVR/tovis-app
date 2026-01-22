// app/api/waitlist/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString, requireClient } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

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

/**
 * Accept either:
 * A) preferredStart + preferredEnd
 * B) desiredFor + flexibilityMinutes -> window derived
 */
function parsePreferredWindow(body: any): { start: Date; end: Date } | { error: string } {
  const preferredStart = toISODateOrNull(body?.preferredStart)
  const preferredEnd = toISODateOrNull(body?.preferredEnd)

  const desiredFor = toISODateOrNull(body?.desiredFor)
  const flexibilityMinutes = clampInt(body?.flexibilityMinutes, 15, 24 * 60, 60)

  let start: Date | null = preferredStart
  let end: Date | null = preferredEnd

  if (!start || !end) {
    if (!desiredFor) return { error: 'Provide preferredStart/preferredEnd OR desiredFor + flexibilityMinutes.' }
    start = new Date(desiredFor.getTime() - flexibilityMinutes * 60_000)
    end = new Date(desiredFor.getTime() + flexibilityMinutes * 60_000)
  }

  if (end <= start) return { error: 'preferredEnd must be after preferredStart.' }

  return { start, end }
}

async function validateMediaBelongsToPro(mediaId: string, professionalId: string) {
  const m = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: { id: true, professionalId: true },
  })
  if (!m) return { ok: false as const, error: 'mediaId not found.' }
  if (m.professionalId !== professionalId) return { ok: false as const, error: 'mediaId does not belong to this professional.' }
  return { ok: true as const }
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res

    const body = await req.json().catch(() => ({}))

    const professionalId = pickString(body?.professionalId)
    const serviceId = pickString(body?.serviceId)
    const mediaId = pickString(body?.mediaId)
    const preferredTimeBucket = pickString(body?.preferredTimeBucket)
    const notes = pickString(body?.notes)

    if (!professionalId) return jsonFail(400, 'Missing professionalId.')
    if (!serviceId) return jsonFail(400, 'Missing serviceId.')

    const window = parsePreferredWindow(body)
    if ('error' in window) return jsonFail(400, window.error)

    if (mediaId) {
      const mediaCheck = await validateMediaBelongsToPro(mediaId, professionalId)
      if (!mediaCheck.ok) return jsonFail(400, mediaCheck.error)
    }

    const existing = await prisma.waitlistEntry.findFirst({
      where: { clientId: auth.clientId, professionalId, serviceId, status: 'ACTIVE' },
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
        status: 'ACTIVE',
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
    if (auth.res) return auth.res

    const body = await req.json().catch(() => ({}))
    const id = pickString(body?.id)
    if (!id) return jsonFail(400, 'Missing id.')

    const existing = await prisma.waitlistEntry.findUnique({
      where: { id },
      select: { id: true, clientId: true, professionalId: true },
    })
    if (!existing) return jsonFail(404, 'Waitlist entry not found.')
    if (existing.clientId !== auth.clientId) return jsonFail(403, 'Forbidden.')

    const window = parsePreferredWindow(body)
    if ('error' in window) return jsonFail(400, window.error)

    const preferredTimeBucket = pickString(body?.preferredTimeBucket)
    const notes = pickString(body?.notes)
    const mediaId = pickString(body?.mediaId)

    if (mediaId) {
      const mediaCheck = await validateMediaBelongsToPro(mediaId, existing.professionalId)
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
        status: 'ACTIVE',
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

    return jsonOk({ entry: updated })
  } catch (e) {
    console.error('PATCH /api/waitlist error', e)
    return jsonFail(500, 'Failed to update waitlist.')
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res

    const { searchParams } = new URL(req.url)
    const id = pickString(searchParams.get('id'))
    if (!id) return jsonFail(400, 'Missing id.')

    const existing = await prisma.waitlistEntry.findUnique({
      where: { id },
      select: { id: true, clientId: true },
    })

    if (!existing) return jsonOk({})
    if (existing.clientId !== auth.clientId) return jsonFail(403, 'Forbidden.')

    await prisma.waitlistEntry.update({ where: { id }, data: { status: 'CANCELLED' } })
    return jsonOk({})
  } catch (e) {
    console.error('DELETE /api/waitlist error', e)
    return jsonFail(500, 'Failed to remove waitlist.')
  }
}
