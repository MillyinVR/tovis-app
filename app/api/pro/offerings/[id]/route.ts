// app/api/pro/offerings/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { Prisma } from '@prisma/client'
import type { ProfessionalLocationType } from '@prisma/client'
import { parseMoney, moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

type PatchBody = {
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

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(extra ?? {}) }, { status })
}

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.trunc(n) === n && n > 0
}

function trimOrNull(v: unknown): string | null | undefined {
  if (v === null) return null
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : null
}

type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type WorkingHoursDay = { enabled: boolean; start: string; end: string }
type WorkingHoursObj = Record<WeekdayKey, WorkingHoursDay>

function defaultWorkingHours(): WorkingHoursObj {
  const make = (enabled: boolean): WorkingHoursDay => ({ enabled, start: '09:00', end: '17:00' })
  return {
    mon: make(true),
    tue: make(true),
    wed: make(true),
    thu: make(true),
    fri: make(true),
    sat: make(false),
    sun: make(false),
  }
}

function parsePriceOrThrow(raw: string, minPrice: Prisma.Decimal, label: 'Salon' | 'Mobile') {
  const s = raw.trim()
  if (!s) throw new Error(`Invalid ${label} price. Use 50 or 49.99`)

  let dec: Prisma.Decimal
  try {
    dec = parseMoney(s)
  } catch {
    throw new Error(`Invalid ${label} price. Use 50 or 49.99`)
  }

  if (dec.lessThan(minPrice)) {
    throw new Error(`${label} price must be at least $${moneyToString(minPrice) ?? '0.00'}`)
  }

  return dec
}

async function ensureBookableLocationsForOffering(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  ensureSalon: boolean
  ensureMobile: boolean
}) {
  const { tx, professionalId, ensureSalon, ensureMobile } = args

  const neededTypes: ProfessionalLocationType[] = []
  if (ensureSalon) neededTypes.push('SALON')
  if (ensureMobile) neededTypes.push('MOBILE_BASE')
  if (!neededTypes.length) return

  const existing = await tx.professionalLocation.findMany({
    where: { professionalId, type: { in: neededTypes as any } },
    select: { id: true, type: true },
    take: 50,
  })

  const existingTypes = new Set(existing.map((l) => l.type))

  for (const type of neededTypes) {
    if (existingTypes.has(type)) continue

    const totalCount = await tx.professionalLocation.count({ where: { professionalId } })
    const shouldBePrimary = totalCount === 0

    const name = type === 'MOBILE_BASE' ? 'Mobile' : 'Salon'

    await tx.professionalLocation.create({
  data: {
    professionalId,
    type,
    name: type === 'MOBILE_BASE' ? 'Set mobile base' : 'Set salon address',
    isPrimary: false,
    isBookable: false,
    timeZone: null,
    workingHours: defaultWorkingHours() as unknown as Prisma.InputJsonValue,
  },
  select: { id: true },
})

  }
}

// Optional: GET one offering (not required by your UI right now, but useful)
export async function GET(_request: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    const profId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!profId) return jsonError('Unauthorized', 401)

    const { id } = await ctx.params
    const offeringId = trimId(id)
    if (!offeringId) return jsonError('Missing offering id.', 400)

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId: profId, isActive: true },
      include: { service: { include: { category: true } } },
    })

    if (!offering) return jsonError('Not found.', 404)

    return NextResponse.json({ ok: true, offering }, { status: 200 })
  } catch (error) {
    console.error('GET /api/pro/offerings/[id] error', error)
    return jsonError('Internal server error.', 500)
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    const profId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!profId) return jsonError('Unauthorized', 401)

    const { id } = await ctx.params
    const offeringId = trimId(id)
    if (!offeringId) return jsonError('Missing offering id.', 400)

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body) return jsonError('Invalid JSON body.', 400)

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.professionalServiceOffering.findFirst({
        where: { id: offeringId, professionalId: profId },
        include: {
          service: {
            select: {
              minPrice: true,
              isActive: true,
              category: { select: { isActive: true } },
            },
          },
        },
      })


      if (!existing) return { kind: 'NOT_FOUND' as const }

      const nextOffersInSalon =
        typeof body.offersInSalon === 'boolean' ? body.offersInSalon : Boolean(existing.offersInSalon)
      const nextOffersMobile =
        typeof body.offersMobile === 'boolean' ? body.offersMobile : Boolean(existing.offersMobile)
      const serviceOk = Boolean(existing.service.isActive && existing.service.category?.isActive)

      if (!serviceOk) {
        // allow only deactivation
        if (body.isActive === false) {
          const saved = await tx.professionalServiceOffering.update({
            where: { id: existing.id },
            data: { isActive: false },
            include: { service: { include: { category: true } } },
          })
          return { kind: 'OK' as const, offering: saved }
        }

        return { kind: 'ERROR' as const, status: 400, msg: 'This service is currently unavailable.' }
      }

      if (!nextOffersInSalon && !nextOffersMobile) {
        return { kind: 'ERROR' as const, status: 400, msg: 'Enable at least Salon or Mobile.' }
      }

      // if toggling a mode ON, ensure a location row exists
      const ensureSalon = body.offersInSalon === true && existing.offersInSalon === false
      const ensureMobile = body.offersMobile === true && existing.offersMobile === false

      if (ensureSalon || ensureMobile) {
        await ensureBookableLocationsForOffering({
          tx,
          professionalId: profId,
          ensureSalon,
          ensureMobile,
        })
      }

      const data: Prisma.ProfessionalServiceOfferingUpdateInput = {}

      const desc = trimOrNull(body.description)
      if (desc !== undefined) data.description = desc

      const img = trimOrNull(body.customImageUrl)
      if (img !== undefined) data.customImageUrl = img

      if (typeof body.offersInSalon === 'boolean') data.offersInSalon = nextOffersInSalon
      if (typeof body.offersMobile === 'boolean') data.offersMobile = nextOffersMobile

      // ---- SALON ----
      if (!nextOffersInSalon) {
        data.salonPriceStartingAt = null
        data.salonDurationMinutes = null
      } else {
        if (body.salonDurationMinutes !== undefined) {
          if (body.salonDurationMinutes === null) {
            return { kind: 'ERROR' as const, status: 400, msg: 'salonDurationMinutes cannot be null when Salon is enabled.' }
          }
          if (!isPositiveInt(body.salonDurationMinutes)) {
            return { kind: 'ERROR' as const, status: 400, msg: 'Invalid salonDurationMinutes.' }
          }
          data.salonDurationMinutes = body.salonDurationMinutes
        }

        if (body.salonPriceStartingAt !== undefined) {
          if (body.salonPriceStartingAt === null) {
            return { kind: 'ERROR' as const, status: 400, msg: 'salonPriceStartingAt cannot be null when Salon is enabled.' }
          }
          try {
            data.salonPriceStartingAt = parsePriceOrThrow(body.salonPriceStartingAt, existing.service.minPrice, 'Salon')
          } catch (e: any) {
            return {
              kind: 'ERROR' as const,
              status: 400,
              msg: e?.message || 'Invalid salon price.',
              extra: { minPrice: moneyToString(existing.service.minPrice) ?? '0.00' },
            }
          }
        }

        const finalSalonDuration =
          (data.salonDurationMinutes as number | undefined) ?? existing.salonDurationMinutes
        const finalSalonPrice =
          (data.salonPriceStartingAt as Prisma.Decimal | null | undefined) ?? existing.salonPriceStartingAt

        if (!isPositiveInt(finalSalonDuration)) {
          return { kind: 'ERROR' as const, status: 400, msg: 'Salon is enabled but salonDurationMinutes is missing/invalid.' }
        }
        if (!finalSalonPrice) {
          return { kind: 'ERROR' as const, status: 400, msg: 'Salon is enabled but salonPriceStartingAt is missing.' }
        }
      }

      // ---- MOBILE ----
      if (!nextOffersMobile) {
        data.mobilePriceStartingAt = null
        data.mobileDurationMinutes = null
      } else {
        if (body.mobileDurationMinutes !== undefined) {
          if (body.mobileDurationMinutes === null) {
            return { kind: 'ERROR' as const, status: 400, msg: 'mobileDurationMinutes cannot be null when Mobile is enabled.' }
          }
          if (!isPositiveInt(body.mobileDurationMinutes)) {
            return { kind: 'ERROR' as const, status: 400, msg: 'Invalid mobileDurationMinutes.' }
          }
          data.mobileDurationMinutes = body.mobileDurationMinutes
        }

        if (body.mobilePriceStartingAt !== undefined) {
          if (body.mobilePriceStartingAt === null) {
            return { kind: 'ERROR' as const, status: 400, msg: 'mobilePriceStartingAt cannot be null when Mobile is enabled.' }
          }
          try {
            data.mobilePriceStartingAt = parsePriceOrThrow(body.mobilePriceStartingAt, existing.service.minPrice, 'Mobile')
          } catch (e: any) {
            return {
              kind: 'ERROR' as const,
              status: 400,
              msg: e?.message || 'Invalid mobile price.',
              extra: { minPrice: moneyToString(existing.service.minPrice) ?? '0.00' },
            }
          }
        }

        const finalMobileDuration =
          (data.mobileDurationMinutes as number | undefined) ?? existing.mobileDurationMinutes
        const finalMobilePrice =
          (data.mobilePriceStartingAt as Prisma.Decimal | null | undefined) ?? existing.mobilePriceStartingAt

        if (!isPositiveInt(finalMobileDuration)) {
          return { kind: 'ERROR' as const, status: 400, msg: 'Mobile is enabled but mobileDurationMinutes is missing/invalid.' }
        }
        if (!finalMobilePrice) {
          return { kind: 'ERROR' as const, status: 400, msg: 'Mobile is enabled but mobilePriceStartingAt is missing.' }
        }
      }

      if (typeof body.isActive === 'boolean') data.isActive = body.isActive

      if (Object.keys(data).length === 0) {
        return { kind: 'OK' as const, offering: existing }
      }

      const saved = await tx.professionalServiceOffering.update({
        where: { id: existing.id },
        data,
        include: { service: { include: { category: true } } },
      })

      return { kind: 'OK' as const, offering: saved }
    })

    if (result.kind === 'NOT_FOUND') return jsonError('Not found.', 404)
    if (result.kind === 'ERROR') return jsonError(result.msg, result.status, (result as any).extra)

    return NextResponse.json({ ok: true, offering: result.offering }, { status: 200 })
  } catch (error) {
    console.error('PATCH /api/pro/offerings/[id] error', error)
    return jsonError('Internal server error.', 500)
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    const profId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!profId) return jsonError('Unauthorized', 401)

    const { id } = await ctx.params
    const offeringId = trimId(id)
    if (!offeringId) return jsonError('Missing offering id.', 400)

    const existing = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId: profId },
      select: { id: true },
    })
    if (!existing) return jsonError('Not found.', 404)

    await prisma.professionalServiceOffering.update({
      where: { id: existing.id },
      data: { isActive: false },
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error('DELETE /api/pro/offerings/[id] error', error)
    return jsonError('Internal server error.', 500)
  }
}
