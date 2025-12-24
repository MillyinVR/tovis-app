// app/api/holds/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isExpired(expiresAt: Date) {
  return expiresAt.getTime() <= Date.now()
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Only clients can view holds.' }, { status: 401 })
    }
    const clientId = user.clientProfile.id

    const { id } = await context.params
    const holdId = pickString(id)
    if (!holdId) {
      return NextResponse.json({ ok: false, error: 'Missing hold id.' }, { status: 400 })
    }

    const hold = await prisma.bookingHold.findUnique({
      where: { id: holdId },
      select: {
        id: true,
        clientId: true,
        offeringId: true,
        professionalId: true,
        scheduledFor: true,
        expiresAt: true,
        locationType: true, // ✅ included
      },
    })

    // Fail closed: do not reveal existence if not owned.
    if (!hold || hold.clientId !== clientId) {
      return NextResponse.json({ ok: false, error: 'Hold not found.' }, { status: 404 })
    }

    if (isExpired(hold.expiresAt)) {
      await prisma.bookingHold.deleteMany({
        where: { id: hold.id, expiresAt: { lte: new Date() } },
      })
      return NextResponse.json({ ok: false, error: 'Hold expired.' }, { status: 409 })
    }

    return NextResponse.json({
      ok: true,
      hold: {
        id: hold.id,
        scheduledFor: hold.scheduledFor.toISOString(),
        expiresAt: hold.expiresAt.toISOString(),
        offeringId: hold.offeringId,
        professionalId: hold.professionalId,
        locationType: hold.locationType,
      },
    })
  } catch (e) {
    console.error('GET /api/holds/[id] error', e)
    return NextResponse.json({ ok: false, error: 'Failed to load hold.' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Only clients can delete holds.' }, { status: 401 })
    }
    const clientId = user.clientProfile.id

    const { id } = await context.params
    const holdId = pickString(id)
    if (!holdId) {
      return NextResponse.json({ ok: false, error: 'Missing hold id.' }, { status: 400 })
    }

    const deleted = await prisma.bookingHold.deleteMany({
      where: { id: holdId, clientId },
    })

    if (deleted.count === 0) {
      return NextResponse.json({ ok: false, error: 'Hold not found.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/holds/[id] error', e)
    return NextResponse.json({ ok: false, error: 'Failed to delete hold.' }, { status: 500 })
  }
}
