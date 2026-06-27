// app/api/v1/pro/offerings/route.ts

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import {
  jsonFail,
  jsonOk,
  pickBool,
  pickInt,
  pickString,
} from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { refreshProfessional } from '@/lib/search/index/refreshSearchIndex'
import { isRecord } from '@/lib/guards'
import { parseMoney, moneyToString } from '@/lib/money'
import { offeringToDto, writeOffering } from '@/lib/offerings/writeOffering'

export const dynamic = 'force-dynamic'

function trimOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return undefined

  const t = v.trim()
  return t ? t : null
}

function isPositiveInt(n: number | null): n is number {
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    Math.trunc(n) === n &&
    n > 0
  )
}

function requirePositiveInt(v: unknown, fieldName: string) {
  const n = pickInt(v)

  if (!isPositiveInt(n)) {
    return { ok: false as const, error: `Invalid ${fieldName}.` }
  }

  return { ok: true as const, value: n }
}

function parsePriceOrThrow(
  raw: string,
  minPrice: Prisma.Decimal,
  label: 'Salon' | 'Mobile',
) {
  const s = raw.trim()

  if (!s) {
    throw new Error(`Missing ${label} price.`)
  }

  let dec: Prisma.Decimal

  try {
    dec = parseMoney(s)
  } catch {
    throw new Error(`Invalid ${label} price. Use 50 or 49.99`)
  }

  if (dec.lessThan(minPrice)) {
    throw new Error(
      `${label} price must be at least $${moneyToString(minPrice) ?? '0.00'}`,
    )
  }

  return dec
}

export async function GET() {
  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const professionalId = auth.professionalId

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
      },
      include: {
        service: {
          include: {
            category: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    })

    return jsonOk({ offerings: offerings.map(offeringToDto) }, 200)
  } catch (error) {
    console.error('GET /api/v1/pro/offerings error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const professionalId = auth.professionalId

    const limited = await enforceRateLimit({
      bucket: 'pro:offerings:write',
      identity: await rateLimitIdentity(auth.userId),
    })

    if (limited) {
      return limited
    }

    const raw: unknown = await request.json().catch(() => null)

    if (!isRecord(raw)) {
      return jsonFail(400, 'Invalid JSON body.')
    }

    const body = raw

    const serviceId = pickString(body.serviceId)

    if (!serviceId) {
      return jsonFail(400, 'Missing serviceId.')
    }

    const description = Object.prototype.hasOwnProperty.call(
      body,
      'description',
    )
      ? trimOrNull(body.description)
      : undefined

    if (
      Object.prototype.hasOwnProperty.call(body, 'description') &&
      description === undefined
    ) {
      return jsonFail(400, 'description must be string or null.')
    }

    const customImageUrl = Object.prototype.hasOwnProperty.call(
      body,
      'customImageUrl',
    )
      ? trimOrNull(body.customImageUrl)
      : undefined

    if (
      Object.prototype.hasOwnProperty.call(body, 'customImageUrl') &&
      customImageUrl === undefined
    ) {
      return jsonFail(400, 'customImageUrl must be string or null.')
    }

    const offersInSalonIn = Object.prototype.hasOwnProperty.call(
      body,
      'offersInSalon',
    )
      ? pickBool(body.offersInSalon)
      : null

    const offersMobileIn = Object.prototype.hasOwnProperty.call(
      body,
      'offersMobile',
    )
      ? pickBool(body.offersMobile)
      : null

    if (
      Object.prototype.hasOwnProperty.call(body, 'offersInSalon') &&
      offersInSalonIn === null
    ) {
      return jsonFail(400, 'offersInSalon must be boolean.')
    }

    if (
      Object.prototype.hasOwnProperty.call(body, 'offersMobile') &&
      offersMobileIn === null
    ) {
      return jsonFail(400, 'offersMobile must be boolean.')
    }

    const offersInSalon =
      typeof offersInSalonIn === 'boolean' ? offersInSalonIn : true

    const offersMobile =
      typeof offersMobileIn === 'boolean' ? offersMobileIn : false

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
        category: {
          select: {
            isActive: true,
            name: true,
          },
        },
      },
    })

    if (!service || !service.isActive || !service.category?.isActive) {
      return jsonFail(400, 'This service is currently unavailable.')
    }

    let salonDurationMinutes: number | null = null
    let mobileDurationMinutes: number | null = null

    if (offersInSalon) {
      const parsedSalonDuration = requirePositiveInt(
        body.salonDurationMinutes,
        'salonDurationMinutes',
      )

      if (!parsedSalonDuration.ok) {
        return jsonFail(400, parsedSalonDuration.error)
      }

      salonDurationMinutes = parsedSalonDuration.value
    }

    if (offersMobile) {
      const parsedMobileDuration = requirePositiveInt(
        body.mobileDurationMinutes,
        'mobileDurationMinutes',
      )

      if (!parsedMobileDuration.ok) {
        return jsonFail(400, parsedMobileDuration.error)
      }

      mobileDurationMinutes = parsedMobileDuration.value
    }

    let salonPrice: Prisma.Decimal | null = null
    let mobilePrice: Prisma.Decimal | null = null

    if (offersInSalon) {
      const rawPrice =
        typeof body.salonPriceStartingAt === 'string'
          ? body.salonPriceStartingAt
          : ''

      try {
        salonPrice = parsePriceOrThrow(rawPrice, service.minPrice, 'Salon')
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid salon price.'

        return jsonFail(400, msg, {
          minPrice: moneyToString(service.minPrice) ?? '0.00',
        })
      }
    }

    if (offersMobile) {
      const rawPrice =
        typeof body.mobilePriceStartingAt === 'string'
          ? body.mobilePriceStartingAt
          : ''

      try {
        mobilePrice = parsePriceOrThrow(rawPrice, service.minPrice, 'Mobile')
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid mobile price.'

        return jsonFail(400, msg, {
          minPrice: moneyToString(service.minPrice) ?? '0.00',
        })
      }
    }

    const offering = await prisma.$transaction((tx) =>
      writeOffering({
        tx,
        professionalId,
        serviceId: service.id,
        offersInSalon,
        offersMobile,
        description: description ?? null,
        customImageUrl: customImageUrl ?? null,
        salonPrice,
        salonDurationMinutes,
        mobilePrice,
        mobileDurationMinutes,
      }),
    )

    await refreshProfessional(professionalId, 'offering.create')

    return jsonOk({ offering: offeringToDto(offering) }, 201)
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return jsonFail(409, 'You already added this service to your menu.')
    }

    console.error('POST /api/v1/pro/offerings error', error)
    return jsonFail(500, 'Internal server error')
  }
}
