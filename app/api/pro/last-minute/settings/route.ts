import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function toDecimalString(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return v.toFixed(2)
  }
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    // allow "80" or "79.99"
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
    // normalize to 2 decimals for consistency
    const n = Number(s)
    if (!Number.isFinite(n)) return null
    return n.toFixed(2)
  }
  return null
}

export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const proId = user.professionalProfile.id

  const settings = await prisma.lastMinuteSettings.upsert({
    where: { professionalId: proId },
    create: {
      professionalId: proId,
      // enabled/discountsEnabled already default false in schema
      // windowSameDayPct/window24hPct already default in schema
    },
    update: {},
    include: {
      serviceRules: true,
      blocks: { orderBy: { startAt: 'asc' } },
    },
  })

  return NextResponse.json({ settings })
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const proId = user.professionalProfile.id
  const body = await req.json().catch(() => ({}))

  const patch: Record<string, any> = {}

  // Core toggles
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.discountsEnabled === 'boolean') patch.discountsEnabled = body.discountsEnabled

  // Discount windows (hard clamp 0–50)
  if (Number.isInteger(body.windowSameDayPct)) {
    patch.windowSameDayPct = Math.min(50, Math.max(0, body.windowSameDayPct))
  }
  if (Number.isInteger(body.window24hPct)) {
    patch.window24hPct = Math.min(50, Math.max(0, body.window24hPct))
  }

  // Global minimum price (Decimal? expects string/Decimal)
  if (body.minPrice === null) {
    patch.minPrice = null
  } else if (body.minPrice !== undefined) {
    const dec = toDecimalString(body.minPrice)
    if (dec === null) {
      return NextResponse.json(
        { error: 'minPrice must be like 80 or 79.99 (or null)' },
        { status: 400 },
      )
    }
    patch.minPrice = dec
  }

  // Day disables
  const dayFlags = [
    'disableMon',
    'disableTue',
    'disableWed',
    'disableThu',
    'disableFri',
    'disableSat',
    'disableSun',
  ] as const

  for (const key of dayFlags) {
    if (typeof body[key] === 'boolean') patch[key] = body[key]
  }

  const settings = await prisma.lastMinuteSettings.upsert({
    where: { professionalId: proId },
    create: { professionalId: proId, ...patch },
    update: patch,
    include: {
      serviceRules: true,
      blocks: { orderBy: { startAt: 'asc' } },
    },
  })

  return NextResponse.json({ settings })
}
