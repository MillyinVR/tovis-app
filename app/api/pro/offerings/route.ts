// app/api/pro/offerings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { parseMoney, moneyToString } from '@/lib/money'
import { Prisma } from '@prisma/client'

type CreateOfferingBody = {
  serviceId: string

  // pro overrides
  title?: string | null
  description?: string | null
  customImageUrl?: string | null

  // location toggles
  offersInSalon?: boolean
  offersMobile?: boolean

  // SALON
  salonPriceStartingAt?: string | null
  salonDurationMinutes?: number | null

  // MOBILE
  mobilePriceStartingAt?: string | null
  mobileDurationMinutes?: number | null
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
  }
}

function isPositiveInt(n: unknown) {
  return typeof n === 'number' && Number.isFinite(n) && Math.trunc(n) === n && n > 0
}

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const prof = user.professionalProfile

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: { professionalId: prof.id, isActive: true },
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
    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profId = user.professionalProfile.id

    const body = (await request.json().catch(() => null)) as Partial<CreateOfferingBody> | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const serviceId = String(body.serviceId || '').trim()
    if (!serviceId) return NextResponse.json({ error: 'Missing serviceId' }, { status: 400 })

    const title = typeof body.title === 'string' ? body.title.trim() : null
    const description = typeof body.description === 'string' ? body.description.trim() : null
    const customImageUrl = typeof body.customImageUrl === 'string' ? body.customImageUrl.trim() : null

    const offersInSalon = typeof body.offersInSalon === 'boolean' ? body.offersInSalon : true
    const offersMobile = typeof body.offersMobile === 'boolean' ? body.offersMobile : false

    if (!offersInSalon && !offersMobile) {
      return NextResponse.json({ error: 'Enable at least Salon or Mobile.' }, { status: 400 })
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        minPrice: true,
      },
    })

    if (!service || !service.isActive) {
      return NextResponse.json({ error: 'Invalid service' }, { status: 400 })
    }

    let salonPriceDecimal: Prisma.Decimal | null = null
    let mobilePriceDecimal: Prisma.Decimal | null = null

    const data: any = {
      professionalId: profId,
      serviceId: service.id,

      title: title || service.name,
      description: description || service.description,
      customImageUrl: customImageUrl || null,

      offersInSalon,
      offersMobile,
    }

    // SALON validation
    if (offersInSalon) {
      const priceInput = typeof body.salonPriceStartingAt === 'string' ? body.salonPriceStartingAt.trim() : ''
      const durInput = body.salonDurationMinutes

      if (!priceInput) {
        return NextResponse.json({ error: 'Missing salonPriceStartingAt' }, { status: 400 })
      }
      if (!isPositiveInt(durInput)) {
        return NextResponse.json({ error: 'Invalid salonDurationMinutes' }, { status: 400 })
      }

      try {
        salonPriceDecimal = parseMoney(priceInput)
      } catch {
        return NextResponse.json({ error: 'Invalid salon price. Use 50 or 49.99' }, { status: 400 })
      }

      if (salonPriceDecimal.lessThan(service.minPrice)) {
        return NextResponse.json(
          {
            error: `Salon price must be at least $${moneyToString(service.minPrice)}`,
            minPrice: moneyToString(service.minPrice),
          },
          { status: 400 },
        )
      }

      data.salonPriceStartingAt = salonPriceDecimal
      data.salonDurationMinutes = durInput
    } else {
      data.salonPriceStartingAt = null
      data.salonDurationMinutes = null
    }

    // MOBILE validation
    if (offersMobile) {
      const priceInput = typeof body.mobilePriceStartingAt === 'string' ? body.mobilePriceStartingAt.trim() : ''
      const durInput = body.mobileDurationMinutes

      if (!priceInput) {
        return NextResponse.json({ error: 'Missing mobilePriceStartingAt' }, { status: 400 })
      }
      if (!isPositiveInt(durInput)) {
        return NextResponse.json({ error: 'Invalid mobileDurationMinutes' }, { status: 400 })
      }

      try {
        mobilePriceDecimal = parseMoney(priceInput)
      } catch {
        return NextResponse.json({ error: 'Invalid mobile price. Use 50 or 49.99' }, { status: 400 })
      }

      if (mobilePriceDecimal.lessThan(service.minPrice)) {
        return NextResponse.json(
          {
            error: `Mobile price must be at least $${moneyToString(service.minPrice)}`,
            minPrice: moneyToString(service.minPrice),
          },
          { status: 400 },
        )
      }

      data.mobilePriceStartingAt = mobilePriceDecimal
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
