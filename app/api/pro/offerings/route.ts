// app/api/pro/offerings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { parseMoney, moneyToString } from '@/lib/money'
import { Prisma } from '@prisma/client'

type CreateOfferingBody = {
  serviceId: string

  // legacy (ignored)
  title?: string | null

  // pro fields
  description?: string | null
  customImageUrl?: string | null

  // toggles
  offersInSalon?: boolean
  offersMobile?: boolean

  // SALON
  salonPriceStartingAt?: string | null
  salonDurationMinutes?: number | null

  // MOBILE
  mobilePriceStartingAt?: string | null
  mobileDurationMinutes?: number | null
}

function isPositiveInt(n: unknown) {
  return typeof n === 'number' && Number.isFinite(n) && Math.trunc(n) === n && n > 0
}

function trimOrNull(v: unknown) {
  if (v === null) return null
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

function parsePriceOrThrow(raw: string, minPrice: Prisma.Decimal, label: string) {
  const s = raw.trim()
  if (!s) throw new Error(`Missing ${label}PriceStartingAt`)

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

function toDto(off: any) {
  return {
    id: String(off.id),
    serviceId: String(off.serviceId),

    // legacy field kept for typing compatibility
    title: null as string | null,

    description: off.description ?? null,
    customImageUrl: off.customImageUrl ?? null,

    offersInSalon: Boolean(off.offersInSalon),
    offersMobile: Boolean(off.offersMobile),

    salonPriceStartingAt: off.salonPriceStartingAt ? moneyToString(off.salonPriceStartingAt) : null,
    salonDurationMinutes: off.salonDurationMinutes ?? null,

    mobilePriceStartingAt: off.mobilePriceStartingAt ? moneyToString(off.mobilePriceStartingAt) : null,
    mobileDurationMinutes: off.mobileDurationMinutes ?? null,

    // canonical display
    serviceName: off.service.name,
    categoryName: off.service.category?.name ?? null,
    serviceDefaultImageUrl: off.service.defaultImageUrl ?? null,

    // admin floor
    minPrice: moneyToString(off.service.minPrice) ?? '0.00',
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profId = user.professionalProfile.id

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: { professionalId: profId, isActive: true },
      include: { service: { include: { category: true } } },
      orderBy: [{ createdAt: 'asc' }],
    })

    return NextResponse.json(offerings.map(toDto), { status: 200 })
  } catch (error) {
    console.error('Get offerings error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profId = user.professionalProfile.id

    const body = (await request.json().catch(() => null)) as Partial<CreateOfferingBody> | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const serviceId = String(body.serviceId || '').trim()
    if (!serviceId) return NextResponse.json({ error: 'Missing serviceId' }, { status: 400 })

    const description = trimOrNull(body.description)
    const customImageUrl = trimOrNull(body.customImageUrl)

    const offersInSalon = typeof body.offersInSalon === 'boolean' ? body.offersInSalon : true
    const offersMobile = typeof body.offersMobile === 'boolean' ? body.offersMobile : false

    if (!offersInSalon && !offersMobile) {
      return NextResponse.json({ error: 'Enable at least Salon or Mobile.' }, { status: 400 })
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, isActive: true, minPrice: true },
    })

    if (!service || !service.isActive) {
      return NextResponse.json({ error: 'Invalid service' }, { status: 400 })
    }

    const data: any = {
      professionalId: profId,
      serviceId: service.id,

      // ✅ canonical naming enforcement: do not store custom title
      title: null,

      description: description || null,
      customImageUrl: customImageUrl || null,

      offersInSalon,
      offersMobile,
    }

    // SALON validation
    if (offersInSalon) {
      const durInput = body.salonDurationMinutes
      if (!isPositiveInt(durInput)) return NextResponse.json({ error: 'Invalid salonDurationMinutes' }, { status: 400 })

      const priceInput = typeof body.salonPriceStartingAt === 'string' ? body.salonPriceStartingAt : ''
      try {
        data.salonPriceStartingAt = parsePriceOrThrow(priceInput, service.minPrice, 'Salon')
      } catch (e: any) {
        return NextResponse.json(
          { error: e?.message || 'Invalid salon price.', minPrice: moneyToString(service.minPrice) },
          { status: 400 },
        )
      }

      data.salonDurationMinutes = durInput
    } else {
      data.salonPriceStartingAt = null
      data.salonDurationMinutes = null
    }

    // MOBILE validation
    if (offersMobile) {
      const durInput = body.mobileDurationMinutes
      if (!isPositiveInt(durInput)) return NextResponse.json({ error: 'Invalid mobileDurationMinutes' }, { status: 400 })

      const priceInput = typeof body.mobilePriceStartingAt === 'string' ? body.mobilePriceStartingAt : ''
      try {
        data.mobilePriceStartingAt = parsePriceOrThrow(priceInput, service.minPrice, 'Mobile')
      } catch (e: any) {
        return NextResponse.json(
          { error: e?.message || 'Invalid mobile price.', minPrice: moneyToString(service.minPrice) },
          { status: 400 },
        )
      }

      data.mobileDurationMinutes = durInput
    } else {
      data.mobilePriceStartingAt = null
      data.mobileDurationMinutes = null
    }

    const offering = await prisma.professionalServiceOffering.create({
      data,
      include: { service: { include: { category: true } } },
    })

    return NextResponse.json(toDto(offering), { status: 201 })
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json({ error: 'You already added this service to your menu.' }, { status: 409 })
      }
    }
    console.error('Create offering error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
