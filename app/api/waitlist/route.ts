// app/api/waitlist/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function toISODateOrNull(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
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
    if (!desiredFor) {
      return { error: 'Provide preferredStart/preferredEnd OR desiredFor + flexibilityMinutes.' }
    }
    start = new Date(desiredFor.getTime() - flexibilityMinutes * 60_000)
    end = new Date(desiredFor.getTime() + flexibilityMinutes * 60_000)
  }

  if (!start || !end) return { error: 'Invalid preferred window.' }
  if (end <= start) return { error: 'preferredEnd must be after preferredStart.' }

  return { start, end }
}

/**
 * Helper: enforce client auth
 */
async function requireClient() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) return null
  return { user, clientId: user.clientProfile.id }
}

/**
 * Optional safety: if mediaId is provided, ensure it belongs to the same pro.
 * (Prevents someone attaching random media across the platform.)
 */
async function validateMediaBelongsToPro(mediaId: string, professionalId: string) {
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
    if (!auth) return NextResponse.json({ error: 'Only clients can join a waitlist.' }, { status: 401 })

    const body = await req.json().catch(() => ({}))

    const professionalId = pickString(body?.professionalId)
    const serviceId = pickString(body?.serviceId)
    const mediaId = pickString(body?.mediaId)

    const preferredTimeBucket = pickString(body?.preferredTimeBucket)
    const notes = pickString(body?.notes)

    if (!professionalId) return NextResponse.json({ error: 'Missing professionalId.' }, { status: 400 })
    if (!serviceId) return NextResponse.json({ error: 'Missing serviceId.' }, { status: 400 })

    const window = parsePreferredWindow(body)
    if ('error' in window) return NextResponse.json({ error: window.error }, { status: 400 })

    if (mediaId) {
      const mediaCheck = await validateMediaBelongsToPro(mediaId, professionalId)
      if (!mediaCheck.ok) return NextResponse.json({ error: mediaCheck.error }, { status: 400 })
    }

    // Prevent duplicate ACTIVE entries for same client+pro+service
    const existing = await prisma.waitlistEntry.findFirst({
      where: {
        clientId: auth.clientId,
        professionalId,
        serviceId,
        status: 'ACTIVE' as any,
      },
      select: { id: true },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'You already have an active waitlist request for this pro/service.' },
        { status: 409 },
      )
    }

    const entry = await prisma.waitlistEntry.create({
      data: {
        clientId: auth.clientId,
        professionalId,
        serviceId,
        mediaId: mediaId || null,
        notes: notes || null,
        preferredStart: window.start,
        preferredEnd: window.end,
        preferredTimeBucket: preferredTimeBucket || null,
        status: 'ACTIVE' as any,
      } as any,
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

    return NextResponse.json({ ok: true, entry }, { status: 201 })
  } catch (e) {
    console.error('POST /api/waitlist error', e)
    return NextResponse.json({ error: 'Failed to join waitlist.' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth) return NextResponse.json({ error: 'Only clients can edit a waitlist.' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const id = pickString(body?.id)
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

    const existing = await prisma.waitlistEntry.findUnique({
      where: { id },
      select: { id: true, clientId: true, professionalId: true, status: true },
    })

    if (!existing) return NextResponse.json({ error: 'Waitlist entry not found.' }, { status: 404 })
    if (existing.clientId !== auth.clientId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

    const window = parsePreferredWindow(body)
    if ('error' in window) return NextResponse.json({ error: window.error }, { status: 400 })

    const preferredTimeBucket = pickString(body?.preferredTimeBucket)
    const notes = pickString(body?.notes)

    // Optional: allow changing mediaId
    const mediaId = pickString(body?.mediaId)
    if (mediaId) {
      const mediaCheck = await validateMediaBelongsToPro(mediaId, existing.professionalId)
      if (!mediaCheck.ok) return NextResponse.json({ error: mediaCheck.error }, { status: 400 })
    }

    const updated = await prisma.waitlistEntry.update({
      where: { id },
      data: {
        preferredStart: window.start,
        preferredEnd: window.end,
        preferredTimeBucket: preferredTimeBucket || null,
        notes: notes || null,
        mediaId: mediaId || null, // if they send null/empty, clears it
        status: 'ACTIVE' as any, // if they edit, assume it becomes active again
      } as any,
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

    return NextResponse.json({ ok: true, entry: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/waitlist error', e)
    return NextResponse.json({ error: 'Failed to update waitlist.' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth) return NextResponse.json({ error: 'Only clients can remove a waitlist.' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = pickString(searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

    const existing = await prisma.waitlistEntry.findUnique({
      where: { id },
      select: { id: true, clientId: true },
    })

    if (!existing) return NextResponse.json({ ok: true }, { status: 200 })
    if (existing.clientId !== auth.clientId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

    await prisma.waitlistEntry.update({
      where: { id },
      data: { status: 'CANCELLED' as any } as any,
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error('DELETE /api/waitlist error', e)
    return NextResponse.json({ error: 'Failed to remove waitlist.' }, { status: 500 })
  }
}
