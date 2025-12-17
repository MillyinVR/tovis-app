// app/api/pro/offerings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { parseMoney, moneyToString } from '@/lib/money'
import { Prisma } from '@prisma/client'

// API boundary: strings (dollars), not floats, not cents
type CreateOfferingBody = {
  serviceId: string
  price: string // dollars string like "49.99"
  durationMinutes: number
  title?: string | null
  customImageUrl?: string | null
  description?: string | null
}

function toDto(off: any) {
  return {
    id: off.id,
    serviceId: off.serviceId,
    title: off.title ?? off.service.name,
    description: off.description ?? off.service.description,
    price: moneyToString(off.price), // ✅ dollars string
    durationMinutes: off.durationMinutes,
    customImageUrl: off.customImageUrl,
    serviceName: off.service.name,
    categoryName: off.service.category?.name ?? null,
    categoryDescription: off.service.category?.description ?? null,
  }
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
      orderBy: { service: { name: 'asc' } },
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

    const prof = user.professionalProfile

    const body = (await request.json().catch(() => null)) as Partial<CreateOfferingBody> | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const serviceId = String(body.serviceId || '').trim()
    const durationMinutes = Number(body.durationMinutes)
    const priceInput = typeof body.price === 'string' ? body.price.trim() : ''

    const title = typeof body.title === 'string' ? body.title.trim() : null
    const customImageUrl = typeof body.customImageUrl === 'string' ? body.customImageUrl.trim() : null
    const description = typeof body.description === 'string' ? body.description.trim() : null

    if (!serviceId) return NextResponse.json({ error: 'Missing serviceId' }, { status: 400 })
    if (!priceInput) return NextResponse.json({ error: 'Missing price' }, { status: 400 })
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return NextResponse.json({ error: 'Invalid durationMinutes' }, { status: 400 })
    }

    let priceDecimal: Prisma.Decimal
    try {
      priceDecimal = parseMoney(priceInput)
    } catch {
      return NextResponse.json({ error: 'Invalid price. Use 50 or 49.99' }, { status: 400 })
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        minPrice: true, // Decimal
      },
    })

    if (!service || !service.isActive) {
      return NextResponse.json({ error: 'Invalid service' }, { status: 400 })
    }

    // ✅ compare Decimals (no JS float nonsense)
    if (priceDecimal.lessThan(service.minPrice)) {
      return NextResponse.json(
        {
          error: `Price must be at least $${moneyToString(service.minPrice)}`,
          minPrice: moneyToString(service.minPrice),
        },
        { status: 400 },
      )
    }

    // ✅ create offering (will throw P2002 if duplicate)
    const offering = await prisma.professionalServiceOffering.create({
      data: {
        professionalId: prof.id,
        serviceId: service.id,
        price: priceDecimal,
        durationMinutes: Math.trunc(durationMinutes),

        // ✅ pro-level overrides (ONLY affects their menu)
        title: title || service.name,
        description: description || service.description,
        customImageUrl: customImageUrl || null,
      },
      include: { service: { include: { category: true } } },
    })

    return NextResponse.json(toDto(offering), { status: 201 })
  } catch (error: any) {
    // ✅ duplicate service added to same pro menu
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json(
          { error: 'You already added this service to your menu.' },
          { status: 409 },
        )
      }
    }

    console.error('Create offering error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
