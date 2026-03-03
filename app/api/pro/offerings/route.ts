// app/api/pro/offerings/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk, pickBool, pickInt, pickString } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { parseMoney, moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function trimOrNull(v: unknown): string | null | undefined {
  // undefined => not provided / invalid type
  // null => explicit clear
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : null
}

function isPositiveInt(n: number | null) {
  return typeof n === 'number' && Number.isFinite(n) && Math.trunc(n) === n && n > 0
}

function defaultWorkingHours(): Prisma.JsonObject {
  const make = (enabled: boolean) => ({ enabled, start: '09:00', end: '17:00' })
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
  if (!s) throw new Error(`Missing ${label} price.`)

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

type OfferingRow = Prisma.ProfessionalServiceOfferingGetPayload<{
  include: { service: { include: { category: true } } }
}>

function toDto(off: OfferingRow) {
  return {
    id: off.id,
    serviceId: off.serviceId,

    title: null as string | null,

    description: off.description ?? null,
    customImageUrl: off.customImageUrl ?? null,

    offersInSalon: Boolean(off.offersInSalon),
    offersMobile: Boolean(off.offersMobile),

    salonPriceStartingAt: off.salonPriceStartingAt ? moneyToString(off.salonPriceStartingAt) : null,
    salonDurationMinutes: off.salonDurationMinutes ?? null,

    mobilePriceStartingAt: off.mobilePriceStartingAt ? moneyToString(off.mobilePriceStartingAt) : null,
    mobileDurationMinutes: off.mobileDurationMinutes ?? null,

    isActive: Boolean(off.isActive),

    // service/library flags + display
    serviceName: off.service.name,
    categoryName: off.service.category?.name ?? null,
    serviceDefaultImageUrl: off.service.defaultImageUrl ?? null,
    minPrice: moneyToString(off.service.minPrice) ?? '0.00',

    isServiceActive: Boolean(off.service.isActive),
    isCategoryActive: Boolean(off.service.category?.isActive),

    serviceIsAddOnEligible: Boolean(off.service.isAddOnEligible),
    serviceAddOnGroup: off.service.addOnGroup ?? null,
  }
}

async function ensureLocationsForOffering(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  offersInSalon: boolean
  offersMobile: boolean
}) {
  const { tx, professionalId, offersInSalon, offersMobile } = args

  const neededTypes: ProfessionalLocationType[] = []
  if (offersInSalon) neededTypes.push(ProfessionalLocationType.SALON)
  if (offersMobile) neededTypes.push(ProfessionalLocationType.MOBILE_BASE)
  if (!neededTypes.length) return

  const existing = await tx.professionalLocation.findMany({
    where: { professionalId, type: { in: neededTypes } },
    select: { type: true },
    take: 50,
  })

  const existingTypes = new Set(existing.map((l) => l.type))

  for (const type of neededTypes) {
    if (existingTypes.has(type)) continue

    const totalCount = await tx.professionalLocation.count({ where: { professionalId } })
    const shouldBePrimary = totalCount === 0

    await tx.professionalLocation.create({
      data: {
        professionalId,
        type,
        name: type === ProfessionalLocationType.MOBILE_BASE ? 'Set mobile base' : 'Set salon address',
        isPrimary: shouldBePrimary,
        isBookable: false,
        timeZone: null,
        workingHours: defaultWorkingHours(),
      },
      select: { id: true },
    })
  }
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: { professionalId, isActive: true },
      include: {
        service: {
          include: {
            category: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    })

    return jsonOk({ offerings: offerings.map(toDto) }, 200)
  } catch (error) {
    console.error('GET /api/pro/offerings error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const raw: unknown = await request.json().catch(() => null)
    if (!isRecord(raw)) return jsonFail(400, 'Invalid JSON body.')
    const body = raw

    const serviceId = pickString(body.serviceId)
    if (!serviceId) return jsonFail(400, 'Missing serviceId.')

    const description = Object.prototype.hasOwnProperty.call(body, 'description') ? trimOrNull(body.description) : undefined
    if (Object.prototype.hasOwnProperty.call(body, 'description') && description === undefined) {
      return jsonFail(400, 'description must be string or null.')
    }

    const customImageUrl = Object.prototype.hasOwnProperty.call(body, 'customImageUrl')
      ? trimOrNull(body.customImageUrl)
      : undefined
    if (Object.prototype.hasOwnProperty.call(body, 'customImageUrl') && customImageUrl === undefined) {
      return jsonFail(400, 'customImageUrl must be string or null.')
    }

    const offersInSalonIn = Object.prototype.hasOwnProperty.call(body, 'offersInSalon') ? pickBool(body.offersInSalon) : null
    const offersMobileIn = Object.prototype.hasOwnProperty.call(body, 'offersMobile') ? pickBool(body.offersMobile) : null

    if (Object.prototype.hasOwnProperty.call(body, 'offersInSalon') && offersInSalonIn === null) {
      return jsonFail(400, 'offersInSalon must be boolean.')
    }
    if (Object.prototype.hasOwnProperty.call(body, 'offersMobile') && offersMobileIn === null) {
      return jsonFail(400, 'offersMobile must be boolean.')
    }

    const offersInSalon = typeof offersInSalonIn === 'boolean' ? offersInSalonIn : true
    const offersMobile = typeof offersMobileIn === 'boolean' ? offersMobileIn : false

    if (!offersInSalon && !offersMobile) {
      return jsonFail(400, 'Enable at least Salon or Mobile.')
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        isActive: true,
        minPrice: true,
        isAddOnEligible: true,
        addOnGroup: true,
        defaultImageUrl: true,
        name: true,
        category: { select: { isActive: true, name: true } },
      },
    })

    if (!service || !service.isActive || !service.category?.isActive) {
      return jsonFail(400, 'This service is currently unavailable.')
    }

    // Validate pricing/durations
    const salonDur = offersInSalon ? pickInt(body.salonDurationMinutes) : null
    const mobileDur = offersMobile ? pickInt(body.mobileDurationMinutes) : null

    if (offersInSalon && !isPositiveInt(salonDur)) return jsonFail(400, 'Invalid salonDurationMinutes.')
    if (offersMobile && !isPositiveInt(mobileDur)) return jsonFail(400, 'Invalid mobileDurationMinutes.')

    let salonPrice: Prisma.Decimal | null = null
    let mobilePrice: Prisma.Decimal | null = null

    if (offersInSalon) {
      const rawPrice = typeof body.salonPriceStartingAt === 'string' ? body.salonPriceStartingAt : ''
      try {
        salonPrice = parsePriceOrThrow(rawPrice, service.minPrice, 'Salon')
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid salon price.'
        return jsonFail(400, msg, { minPrice: moneyToString(service.minPrice) ?? '0.00' })
      }
    }

    if (offersMobile) {
      const rawPrice = typeof body.mobilePriceStartingAt === 'string' ? body.mobilePriceStartingAt : ''
      try {
        mobilePrice = parsePriceOrThrow(rawPrice, service.minPrice, 'Mobile')
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid mobile price.'
        return jsonFail(400, msg, { minPrice: moneyToString(service.minPrice) ?? '0.00' })
      }
    }

    const offering = await prisma.$transaction(async (tx) => {
      await ensureLocationsForOffering({
        tx,
        professionalId,
        offersInSalon,
        offersMobile,
      })

      return tx.professionalServiceOffering.create({
        data: {
          professionalId,
          serviceId: service.id,

          title: null,
          description: description ?? null,
          customImageUrl: customImageUrl ?? null,

          offersInSalon,
          offersMobile,

          salonPriceStartingAt: offersInSalon ? salonPrice : null,
          salonDurationMinutes: offersInSalon ? (salonDur as number) : null,

          mobilePriceStartingAt: offersMobile ? mobilePrice : null,
          mobileDurationMinutes: offersMobile ? (mobileDur as number) : null,
        },
        include: { service: { include: { category: true } } },
      })
    })

    return jsonOk({ offering: toDto(offering) }, 201)
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return jsonFail(409, 'You already added this service to your menu.')
    }
    console.error('POST /api/pro/offerings error', error)
    return jsonFail(500, 'Internal server error')
  }
}