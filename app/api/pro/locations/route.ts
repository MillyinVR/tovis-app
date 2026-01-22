// app/api/pro/locations/route.ts 
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

const DEFAULT_WORKING_HOURS = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: false, start: '09:00', end: '17:00' },
  sun: { enabled: false, start: '09:00', end: '17:00' },
} as const

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

function normalizeLocationType(v: unknown) {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  // Adjust these to your actual enum values
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE_BASE') return 'MOBILE_BASE'
  return null
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const professionalId = user.professionalProfile.id

    const locations = await prisma.professionalLocation.findMany({
      where: { professionalId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        type: true,
        name: true,
        isPrimary: true,
        isBookable: true,
        formattedAddress: true,
        city: true,
        state: true,
        postalCode: true,
        countryCode: true,
        placeId: true,
        lat: true,
        lng: true,
        timeZone: true,
        workingHours: true,
        createdAt: true,
      },
      take: 100,
    })

    return NextResponse.json(
      {
        ok: true,
        locations: locations.map((l) => ({
          ...l,
          createdAt: l.createdAt.toISOString(),
        })),
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/pro/locations error', e)
    return NextResponse.json({ ok: false, error: 'Failed to load locations' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const professionalId = user.professionalProfile.id
    const body = await req.json().catch(() => ({}))

    const type = normalizeLocationType(body.type)
    if (!type) return NextResponse.json({ ok: false, error: 'Missing/invalid type.' }, { status: 400 })

    const name = pickString(body.name)
    const isPrimary = pickBool(body.isPrimary) ?? false
    const isBookable = pickBool(body.isBookable) ?? true

    const placeId = pickString(body.placeId)
    const formattedAddress = pickString(body.formattedAddress)

    const city = pickString(body.city)
    const state = pickString(body.state)
    const postalCode = pickString(body.postalCode)
    const countryCode = pickString(body.countryCode)

    const lat = pickNumber(body.lat)
    const lng = pickNumber(body.lng)
    const timeZone = pickString(body.timeZone)

    // If you're creating a SALON location, you really want an address.
    if (type === 'SALON' && (!placeId || !formattedAddress || lat == null || lng == null)) {
      return NextResponse.json({ ok: false, error: 'Salon locations require a Google place (address + lat/lng).' }, { status: 400 })
    }

    const created = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.professionalLocation.updateMany({
          where: { professionalId },
          data: { isPrimary: false },
        })
      }

      return tx.professionalLocation.create({
        data: {
          professionalId,
          type: type as any,
          name,
          isPrimary,
          isBookable,

          placeId,
          formattedAddress,
          city,
          state,
          postalCode,
          countryCode,

          lat,
          lng,
          timeZone,

          // IMPORTANT: your model has workingHours Json (required).
          // Never write null. Default to a full object.
          workingHours: DEFAULT_WORKING_HOURS as any,
        } as any,
        select: { id: true },
      })
    })

    return NextResponse.json({ ok: true, id: created.id }, { status: 201 })
  } catch (e: any) {
    console.error('POST /api/pro/locations error', e)
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to create location' }, { status: 500 })
  }
}
