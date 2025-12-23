// app/api/pro/offerings/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { parseMoney, moneyToString } from '@/lib/money'
import { Prisma } from '@prisma/client'

type PatchBody = {
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

function toDto(off: any) {
  return {
    id: off.id,
    serviceId: off.serviceId,

    title: off.title ?? off.service.name,
    description: off.description ?? off.service.description,
    customImageUrl: off.customImageUrl ?? null,

    offersInSalon: Boolean(off.offersInSalon),
    offersMobile: Boolean(off.offersMobile),

    salonPriceStartingAt: off.salonPriceStartingAt ? moneyToString(off.salonPriceStartingAt) : null,
    salonDurationMinutes: off.salonDurationMinutes ?? null,

    mobilePriceStartingAt: off.mobilePriceStartingAt ? moneyToString(off.mobilePriceStartingAt) : null,
    mobileDurationMinutes: off.mobileDurationMinutes ?? null,

    serviceName: off.service.name,
    categoryName: off.service.category?.name ?? null,
    categoryDescription: off.service.category?.description ?? null,
    defaultImageUrl: off.service.defaultImageUrl ?? null,

    isActive: off.isActive,
  }
}

function isPositiveInt(n: unknown) {
  return typeof n === 'number' && Number.isFinite(n) && Math.trunc(n) === n && n > 0
}

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser()
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
      include: {
        service: { select: { name: true, description: true, minPrice: true, category: true, defaultImageUrl: true } },
      },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const data: any = {}

    // text fields
    if (typeof body.title === 'string' || body.title === null) data.title = body.title?.trim() || null
    if (typeof body.description === 'string' || body.description === null) data.description = body.description?.trim() || null
    if (typeof body.customImageUrl === 'string' || body.customImageUrl === null) data.customImageUrl = body.customImageUrl?.trim() || null

    // toggles
    let offersInSalon = existing.offersInSalon
    let offersMobile = existing.offersMobile
    if (typeof body.offersInSalon === 'boolean') offersInSalon = body.offersInSalon
    if (typeof body.offersMobile === 'boolean') offersMobile = body.offersMobile

    if (!offersInSalon && !offersMobile) {
      return NextResponse.json({ error: 'Enable at least Salon or Mobile.' }, { status: 400 })
    }

    if (typeof body.offersInSalon === 'boolean') data.offersInSalon = offersInSalon
    if (typeof body.offersMobile === 'boolean') data.offersMobile = offersMobile

    // SALON patch
    if (offersInSalon) {
      if (typeof body.salonDurationMinutes === 'number') {
        const d = Math.trunc(body.salonDurationMinutes)
        if (!Number.isFinite(d) || d <= 0) return NextResponse.json({ error: 'Invalid salonDurationMinutes' }, { status: 400 })
        data.salonDurationMinutes = d
      }

      if (typeof body.salonPriceStartingAt === 'string') {
        const s = body.salonPriceStartingAt.trim()
        if (!s) return NextResponse.json({ error: 'Invalid salon price. Use 50 or 49.99' }, { status: 400 })

        let dec: Prisma.Decimal
        try {
          dec = parseMoney(s)
        } catch {
          return NextResponse.json({ error: 'Invalid salon price. Use 50 or 49.99' }, { status: 400 })
        }

        if (dec.lessThan(existing.service.minPrice)) {
          return NextResponse.json(
            { error: `Salon price must be at least $${moneyToString(existing.service.minPrice)}`, minPrice: moneyToString(existing.service.minPrice) },
            { status: 400 },
          )
        }

        data.salonPriceStartingAt = dec
      }
    } else {
      // if turned off, wipe fields
      data.salonPriceStartingAt = null
      data.salonDurationMinutes = null
    }

    // MOBILE patch
    if (offersMobile) {
      if (typeof body.mobileDurationMinutes === 'number') {
        const d = Math.trunc(body.mobileDurationMinutes)
        if (!Number.isFinite(d) || d <= 0) return NextResponse.json({ error: 'Invalid mobileDurationMinutes' }, { status: 400 })
        data.mobileDurationMinutes = d
      }

      if (typeof body.mobilePriceStartingAt === 'string') {
        const s = body.mobilePriceStartingAt.trim()
        if (!s) return NextResponse.json({ error: 'Invalid mobile price. Use 50 or 49.99' }, { status: 400 })

        let dec: Prisma.Decimal
        try {
          dec = parseMoney(s)
        } catch {
          return NextResponse.json({ error: 'Invalid mobile price. Use 50 or 49.99' }, { status: 400 })
        }

        if (dec.lessThan(existing.service.minPrice)) {
          return NextResponse.json(
            { error: `Mobile price must be at least $${moneyToString(existing.service.minPrice)}`, minPrice: moneyToString(existing.service.minPrice) },
            { status: 400 },
          )
        }

        data.mobilePriceStartingAt = dec
      }
    } else {
      data.mobilePriceStartingAt = null
      data.mobileDurationMinutes = null
    }

    // soft toggle
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive

    if (Object.keys(data).length === 0) {
      const fresh = await prisma.professionalServiceOffering.findUnique({
        where: { id: existing.id },
        include: { service: { include: { category: true } } },
      })
      return NextResponse.json({ offering: fresh ? toDto(fresh) : null }, { status: 200 })
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
    const user = await getCurrentUser()
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
