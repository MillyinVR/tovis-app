// app/api/pro/offerings/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { parseMoney, moneyToString } from '@/lib/money'

type PatchBody = {
  title?: string | null
  description?: string | null
  customImageUrl?: string | null
  price?: string | null // dollars string "49.99"
  durationMinutes?: number | null
  isActive?: boolean
}

function toDto(off: any) {
  return {
    id: off.id,
    serviceId: off.serviceId,
    title: off.title ?? off.service.name,
    description: off.description ?? off.service.description,
    price: moneyToString(off.price) ?? '0.00',
    durationMinutes: off.durationMinutes,
    customImageUrl: off.customImageUrl ?? null,
    serviceName: off.service.name,
    categoryName: off.service.category?.name ?? null,
    categoryDescription: off.service.category?.description ?? null,
    isActive: off.isActive,
  }
}

type Ctx = { params: Promise<{ id: string }> } // ✅ your Next runtime treats params as Promise

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

    // Only allow updating your own offering + load service minPrice for validation
    const existing = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId: profId },
      include: {
        service: { select: { name: true, description: true, minPrice: true, category: true } },
      },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const data: any = {}

    // Strings (trim or null)
    if (typeof body.title === 'string' || body.title === null) {
      data.title = body.title?.trim() || null
    }
    if (typeof body.description === 'string' || body.description === null) {
      data.description = body.description?.trim() || null
    }
    if (typeof body.customImageUrl === 'string' || body.customImageUrl === null) {
      data.customImageUrl = body.customImageUrl?.trim() || null
    }

    // Duration
    if (typeof body.durationMinutes === 'number') {
      const d = Math.trunc(body.durationMinutes)
      if (!Number.isFinite(d) || d <= 0) {
        return NextResponse.json({ error: 'Invalid durationMinutes' }, { status: 400 })
      }
      data.durationMinutes = d
    }

    // Price
    if (typeof body.price === 'string') {
      const priceInput = body.price.trim()
      if (!priceInput) {
        return NextResponse.json({ error: 'Invalid price. Use 50 or 49.99' }, { status: 400 })
      }

      let priceDecimal
      try {
        priceDecimal = parseMoney(priceInput)
      } catch {
        return NextResponse.json({ error: 'Invalid price. Use 50 or 49.99' }, { status: 400 })
      }

      if (priceDecimal.lessThan(existing.service.minPrice)) {
        return NextResponse.json(
          {
            error: `Price must be at least $${moneyToString(existing.service.minPrice)}`,
            minPrice: moneyToString(existing.service.minPrice),
          },
          { status: 400 },
        )
      }

      data.price = priceDecimal
    }

    // Soft toggle
    if (typeof body.isActive === 'boolean') {
      data.isActive = body.isActive
    }

    // Nothing to update, return current
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
