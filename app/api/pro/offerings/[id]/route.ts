// app/api/pro/offerings/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { parseMoney, moneyToString } from '@/lib/money'
import { Prisma } from '@prisma/client'

type PatchBody = {
  // legacy (ignored)
  title?: string | null

  description?: string | null
  customImageUrl?: string | null

  offersInSalon?: boolean
  offersMobile?: boolean

  salonPriceStartingAt?: string | null
  salonDurationMinutes?: number | null

  mobilePriceStartingAt?: string | null
  mobileDurationMinutes?: number | null

  isActive?: boolean
}

type Ctx = { params: Promise<{ id: string }> }

function isPositiveInt(n: unknown) {
  return typeof n === 'number' && Number.isFinite(n) && Math.trunc(n) === n && n > 0
}

function trimOrNull(v: unknown) {
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : null
}

function toDto(off: any) {
  return {
    id: String(off.id),
    serviceId: String(off.serviceId),

    // legacy kept for typing compatibility
    title: null as string | null,

    description: off.description ?? null,
    customImageUrl: off.customImageUrl ?? null,

    offersInSalon: Boolean(off.offersInSalon),
    offersMobile: Boolean(off.offersMobile),

    salonPriceStartingAt: off.salonPriceStartingAt ? moneyToString(off.salonPriceStartingAt) : null,
    salonDurationMinutes: off.salonDurationMinutes ?? null,

    mobilePriceStartingAt: off.mobilePriceStartingAt ? moneyToString(off.mobilePriceStartingAt) : null,
    mobileDurationMinutes: off.mobileDurationMinutes ?? null,

    serviceName: off.service.name,
    categoryName: off.service.category?.name ?? null,
    serviceDefaultImageUrl: off.service.defaultImageUrl ?? null,
    minPrice: moneyToString(off.service.minPrice) ?? '0.00',

    isActive: Boolean(off.isActive),
  }
}

function parsePriceOrThrow(raw: string, minPrice: Prisma.Decimal, label: string) {
  const s = raw.trim()
  if (!s) throw new Error(`Invalid ${label} price. Use 50 or 49.99`)

  let dec: Prisma.Decimal
  try {
    dec = parseMoney(s)
  } catch {
    throw new Error(`Invalid ${label} price. Use 50 or 49.99`)
  }

  if (dec.lessThan(minPrice)) {
    throw new Error(`${label} price must be at least $${moneyToString(minPrice)}`)
  }

  return dec
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await ctx.params
    const offeringId = String(id || '').trim()
    if (!offeringId) return NextResponse.json({ error: 'Missing offering id' }, { status: 400 })

    const profId = user.professionalProfile.id

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const existing = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId: profId },
      include: { service: { include: { category: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Resolve requested toggles (default to existing)
    let offersInSalon = Boolean(existing.offersInSalon)
    let offersMobile = Boolean(existing.offersMobile)

    if (typeof body.offersInSalon === 'boolean') offersInSalon = body.offersInSalon
    if (typeof body.offersMobile === 'boolean') offersMobile = body.offersMobile

    if (!offersInSalon && !offersMobile) {
      return NextResponse.json({ error: 'Enable at least Salon or Mobile.' }, { status: 400 })
    }

    const data: Record<string, any> = {}

    // ✅ text fields
    const desc = trimOrNull(body.description)
    if (desc !== undefined) data.description = desc

    const img = trimOrNull(body.customImageUrl)
    if (img !== undefined) data.customImageUrl = img

    // ✅ toggles (only set if changed was requested, but we also need them for validation below)
    if (typeof body.offersInSalon === 'boolean') data.offersInSalon = offersInSalon
    if (typeof body.offersMobile === 'boolean') data.offersMobile = offersMobile

    // -------- SALON mode rules --------
    if (!offersInSalon) {
      data.salonPriceStartingAt = null
      data.salonDurationMinutes = null
    } else {
      // duration: accept patch value if provided; else keep existing
      if (body.salonDurationMinutes !== undefined) {
        if (body.salonDurationMinutes === null) {
          return NextResponse.json({ error: 'salonDurationMinutes cannot be null when Salon is enabled.' }, { status: 400 })
        }
        if (!isPositiveInt(body.salonDurationMinutes)) {
          return NextResponse.json({ error: 'Invalid salonDurationMinutes' }, { status: 400 })
        }
        data.salonDurationMinutes = body.salonDurationMinutes
      }

      // price: accept patch value if provided; else keep existing
      if (body.salonPriceStartingAt !== undefined) {
        if (body.salonPriceStartingAt === null) {
          return NextResponse.json({ error: 'salonPriceStartingAt cannot be null when Salon is enabled.' }, { status: 400 })
        }
        try {
          data.salonPriceStartingAt = parsePriceOrThrow(body.salonPriceStartingAt, existing.service.minPrice, 'Salon')
        } catch (e: any) {
          return NextResponse.json(
            { error: e?.message || 'Invalid salon price.', minPrice: moneyToString(existing.service.minPrice) },
            { status: 400 },
          )
        }
      }

      // Enforce completeness if salon is enabled (even if patch only toggled it on)
      const finalSalonDuration =
        data.salonDurationMinutes !== undefined ? data.salonDurationMinutes : existing.salonDurationMinutes
      const finalSalonPrice =
        data.salonPriceStartingAt !== undefined ? data.salonPriceStartingAt : existing.salonPriceStartingAt

      if (!isPositiveInt(finalSalonDuration)) {
        return NextResponse.json({ error: 'Salon is enabled but salonDurationMinutes is missing/invalid.' }, { status: 400 })
      }
      if (!finalSalonPrice) {
        return NextResponse.json(
          { error: 'Salon is enabled but salonPriceStartingAt is missing.' },
          { status: 400 },
        )
      }
    }

    // -------- MOBILE mode rules --------
    if (!offersMobile) {
      data.mobilePriceStartingAt = null
      data.mobileDurationMinutes = null
    } else {
      if (body.mobileDurationMinutes !== undefined) {
        if (body.mobileDurationMinutes === null) {
          return NextResponse.json({ error: 'mobileDurationMinutes cannot be null when Mobile is enabled.' }, { status: 400 })
        }
        if (!isPositiveInt(body.mobileDurationMinutes)) {
          return NextResponse.json({ error: 'Invalid mobileDurationMinutes' }, { status: 400 })
        }
        data.mobileDurationMinutes = body.mobileDurationMinutes
      }

      if (body.mobilePriceStartingAt !== undefined) {
        if (body.mobilePriceStartingAt === null) {
          return NextResponse.json({ error: 'mobilePriceStartingAt cannot be null when Mobile is enabled.' }, { status: 400 })
        }
        try {
          data.mobilePriceStartingAt = parsePriceOrThrow(body.mobilePriceStartingAt, existing.service.minPrice, 'Mobile')
        } catch (e: any) {
          return NextResponse.json(
            { error: e?.message || 'Invalid mobile price.', minPrice: moneyToString(existing.service.minPrice) },
            { status: 400 },
          )
        }
      }

      const finalMobileDuration =
        data.mobileDurationMinutes !== undefined ? data.mobileDurationMinutes : existing.mobileDurationMinutes
      const finalMobilePrice =
        data.mobilePriceStartingAt !== undefined ? data.mobilePriceStartingAt : existing.mobilePriceStartingAt

      if (!isPositiveInt(finalMobileDuration)) {
        return NextResponse.json({ error: 'Mobile is enabled but mobileDurationMinutes is missing/invalid.' }, { status: 400 })
      }
      if (!finalMobilePrice) {
        return NextResponse.json(
          { error: 'Mobile is enabled but mobilePriceStartingAt is missing.' },
          { status: 400 },
        )
      }
    }

    // soft toggle
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ offering: toDto(existing) }, { status: 200 })
    }

    const updated = await prisma.professionalServiceOffering.update({
      where: { id: existing.id },
      data,
      include: { service: { include: { category: true } } },
    })

    return NextResponse.json({ offering: toDto(updated) }, { status: 200 })
  } catch (error) {
    console.error('Patch offering error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await ctx.params
    const offeringId = String(id || '').trim()
    if (!offeringId) return NextResponse.json({ error: 'Missing offering id' }, { status: 400 })

    const profId = user.professionalProfile.id

    const existing = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId: profId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.professionalServiceOffering.update({
      where: { id: existing.id },
      data: { isActive: false },
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error('Delete offering error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
