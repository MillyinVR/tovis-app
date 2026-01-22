// app/api/pro/locations/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function pickBool(v: unknown) {
  return typeof v === 'boolean' ? v : null
}
function pickNumber(v: unknown) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const professionalId = user.professionalProfile.id
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 })

    const body = await req.json().catch(() => ({}))

    const name = pickString(body.name)
    const isPrimary = pickBool(body.isPrimary)
    const isBookable = pickBool(body.isBookable)

    const placeId = pickString(body.placeId)
    const formattedAddress = pickString(body.formattedAddress)
    const city = pickString(body.city)
    const state = pickString(body.state)
    const postalCode = pickString(body.postalCode)
    const countryCode = pickString(body.countryCode)
    const lat = pickNumber(body.lat)
    const lng = pickNumber(body.lng)
    const timeZone = pickString(body.timeZone)

    const workingHours = body.workingHours && typeof body.workingHours === 'object' ? body.workingHours : null

    await prisma.$transaction(async (tx) => {
      if (isPrimary === true) {
        await tx.professionalLocation.updateMany({
          where: { professionalId },
          data: { isPrimary: false },
        })
      }

      await tx.professionalLocation.updateMany({
        where: { id, professionalId },
        data: {
          ...(name !== null ? { name } : {}),
          ...(isPrimary !== null ? { isPrimary } : {}),
          ...(isBookable !== null ? { isBookable } : {}),

          ...(placeId !== null ? { placeId } : {}),
          ...(formattedAddress !== null ? { formattedAddress } : {}),
          ...(city !== null ? { city } : {}),
          ...(state !== null ? { state } : {}),
          ...(postalCode !== null ? { postalCode } : {}),
          ...(countryCode !== null ? { countryCode } : {}),
          ...(lat !== null ? { lat } : {}),
          ...(lng !== null ? { lng } : {}),
          ...(timeZone !== null ? { timeZone } : {}),

          ...(workingHours ? { workingHours: workingHours as any } : {}),
        } as any,
      })
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e: any) {
    console.error('PATCH /api/pro/locations/[id] error', e)
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update location' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const professionalId = user.professionalProfile.id
    const { id } = await ctx.params
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 })

    // onDelete: Restrict may throw if bookings exist
    await prisma.professionalLocation.delete({
      where: { id, professionalId } as any,
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : 'Failed to delete location'
    console.error('DELETE /api/pro/locations/[id] error', e)
    return NextResponse.json(
      {
        ok: false,
        error:
          msg.includes('Foreign key constraint') || msg.includes('violates foreign key')
            ? 'This location is used by existing bookings and cannot be deleted.'
            : msg,
      },
      { status: 500 },
    )
  }
}
