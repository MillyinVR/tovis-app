// app/api/pro/offerings/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { parseMoney, moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type JsonObject = Record<string, unknown>
type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type WorkingHoursDay = { enabled: boolean; start: string; end: string }
type WorkingHoursObj = Record<WeekdayKey, WorkingHoursDay>

type UpdateResult =
  | { kind: 'NOT_FOUND' }
  | { kind: 'ERROR'; status: number; msg: string; extra?: Record<string, unknown> }
  | { kind: 'OK'; offering: OfferingRow }

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function trimOrNull(v: unknown): string | null | undefined {
  if (v === null) return null
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed ? trimmed : null
}

function pickBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function pickNullablePriceString(v: unknown): string | null | undefined {
  if (v === null) return null
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  return v
}

function isPositiveIntValue(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.trunc(v) === v && v > 0
}

function pickNullablePositiveInt(v: unknown): number | null | undefined {
  if (v === null) return null
  if (v === undefined) return undefined
  if (!isPositiveIntValue(v)) return undefined
  return v
}

function defaultWorkingHours(): Prisma.InputJsonObject {
  const make = (enabled: boolean): WorkingHoursDay => ({
    enabled,
    start: '09:00',
    end: '17:00',
  })

  const value: WorkingHoursObj = {
    mon: make(true),
    tue: make(true),
    wed: make(true),
    thu: make(true),
    fri: make(true),
    sat: make(false),
    sun: make(false),
  }

  return value
}

function parsePriceOrThrow(raw: string, minPrice: Prisma.Decimal, label: 'Salon' | 'Mobile') {
  const s = raw.trim()
  if (!s) {
    throw new Error(`Invalid ${label} price. Use 50 or 49.99`)
  }

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

function salonCapableTypes(): readonly ProfessionalLocationType[] {
  return [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function mobileCapableTypes(): readonly ProfessionalLocationType[] {
  return [ProfessionalLocationType.MOBILE_BASE]
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
  ensureSalon: boolean
  ensureMobile: boolean
}) {
  const { tx, professionalId, ensureSalon, ensureMobile } = args

  if (!ensureSalon && !ensureMobile) return

  const relevantTypes: ProfessionalLocationType[] = [
    ...(ensureSalon ? salonCapableTypes() : []),
    ...(ensureMobile ? mobileCapableTypes() : []),
  ]

  const existing = await tx.professionalLocation.findMany({
    where: {
      professionalId,
      type: { in: relevantTypes },
    },
    select: {
      type: true,
    },
    take: 50,
  })

  const existingTypes = new Set(existing.map((location) => location.type))
  const hasSalonCapableLocation = salonCapableTypes().some((type) => existingTypes.has(type))
  const hasMobileCapableLocation = existingTypes.has(ProfessionalLocationType.MOBILE_BASE)

  let totalLocationCount = await tx.professionalLocation.count({
    where: { professionalId },
  })

  if (ensureSalon && !hasSalonCapableLocation) {
    await tx.professionalLocation.create({
      data: {
        professionalId,
        type: ProfessionalLocationType.SALON,
        name: 'Set salon address',
        isPrimary: totalLocationCount === 0,
        isBookable: false,
        timeZone: null,
        workingHours: defaultWorkingHours(),
      },
      select: { id: true },
    })
    totalLocationCount += 1
  }

  if (ensureMobile && !hasMobileCapableLocation) {
    await tx.professionalLocation.create({
      data: {
        professionalId,
        type: ProfessionalLocationType.MOBILE_BASE,
        name: 'Set mobile base',
        isPrimary: totalLocationCount === 0,
        isBookable: false,
        timeZone: null,
        workingHours: defaultWorkingHours(),
      },
      select: { id: true },
    })
  }
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const offeringId = trimId(params.id)
    if (!offeringId) {
      return jsonFail(400, 'Missing offering id.')
    }

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: {
        id: offeringId,
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
    })

    if (!offering) {
      return jsonFail(404, 'Not found.')
    }

    return jsonOk({ offering: toDto(offering) }, 200)
  } catch (error) {
    console.error('GET /api/pro/offerings/[id] error', error)
    return jsonFail(500, 'Internal server error.')
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const offeringId = trimId(params.id)
    if (!offeringId) {
      return jsonFail(400, 'Missing offering id.')
    }

    const raw: unknown = await request.json().catch(() => null)
    if (!isRecord(raw)) {
      return jsonFail(400, 'Invalid JSON body.')
    }

    const body = raw

    const result: UpdateResult = await prisma.$transaction(async (tx) => {
      const existing = await tx.professionalServiceOffering.findFirst({
        where: {
          id: offeringId,
          professionalId,
        },
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })

      if (!existing) {
        return { kind: 'NOT_FOUND' }
      }

      const offersInSalonIn = Object.prototype.hasOwnProperty.call(body, 'offersInSalon')
        ? pickBoolean(body.offersInSalon)
        : undefined

      const offersMobileIn = Object.prototype.hasOwnProperty.call(body, 'offersMobile')
        ? pickBoolean(body.offersMobile)
        : undefined

      if (Object.prototype.hasOwnProperty.call(body, 'offersInSalon') && offersInSalonIn === undefined) {
        return { kind: 'ERROR', status: 400, msg: 'offersInSalon must be boolean.' }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'offersMobile') && offersMobileIn === undefined) {
        return { kind: 'ERROR', status: 400, msg: 'offersMobile must be boolean.' }
      }

      const nextOffersInSalon =
        typeof offersInSalonIn === 'boolean' ? offersInSalonIn : Boolean(existing.offersInSalon)

      const nextOffersMobile =
        typeof offersMobileIn === 'boolean' ? offersMobileIn : Boolean(existing.offersMobile)

      const serviceOk = Boolean(existing.service.isActive && existing.service.category?.isActive)

      if (!serviceOk) {
        const isActiveIn = Object.prototype.hasOwnProperty.call(body, 'isActive')
          ? pickBoolean(body.isActive)
          : undefined

        if (Object.prototype.hasOwnProperty.call(body, 'isActive') && isActiveIn === undefined) {
          return { kind: 'ERROR', status: 400, msg: 'isActive must be boolean.' }
        }

        if (isActiveIn === false) {
          const saved = await tx.professionalServiceOffering.update({
            where: { id: existing.id },
            data: { isActive: false },
            include: {
              service: {
                include: {
                  category: true,
                },
              },
            },
          })

          return { kind: 'OK', offering: saved }
        }

        return { kind: 'ERROR', status: 400, msg: 'This service is currently unavailable.' }
      }

      if (!nextOffersInSalon && !nextOffersMobile) {
        return { kind: 'ERROR', status: 400, msg: 'Enable at least Salon or Mobile.' }
      }

      const ensureSalon = offersInSalonIn === true && existing.offersInSalon === false
      const ensureMobile = offersMobileIn === true && existing.offersMobile === false

      if (ensureSalon || ensureMobile) {
        await ensureLocationsForOffering({
          tx,
          professionalId,
          ensureSalon,
          ensureMobile,
        })
      }

      const data: Prisma.ProfessionalServiceOfferingUpdateInput = {}

      const description = Object.prototype.hasOwnProperty.call(body, 'description')
        ? trimOrNull(body.description)
        : undefined
      if (Object.prototype.hasOwnProperty.call(body, 'description') && description === undefined) {
        return { kind: 'ERROR', status: 400, msg: 'description must be string or null.' }
      }
      if (description !== undefined) {
        data.description = description
      }

      const customImageUrl = Object.prototype.hasOwnProperty.call(body, 'customImageUrl')
        ? trimOrNull(body.customImageUrl)
        : undefined
      if (Object.prototype.hasOwnProperty.call(body, 'customImageUrl') && customImageUrl === undefined) {
        return { kind: 'ERROR', status: 400, msg: 'customImageUrl must be string or null.' }
      }
      if (customImageUrl !== undefined) {
        data.customImageUrl = customImageUrl
      }

      if (typeof offersInSalonIn === 'boolean') {
        data.offersInSalon = nextOffersInSalon
      }
      if (typeof offersMobileIn === 'boolean') {
        data.offersMobile = nextOffersMobile
      }

      const salonPriceIn = Object.prototype.hasOwnProperty.call(body, 'salonPriceStartingAt')
        ? pickNullablePriceString(body.salonPriceStartingAt)
        : undefined
      const salonDurationIn = Object.prototype.hasOwnProperty.call(body, 'salonDurationMinutes')
        ? pickNullablePositiveInt(body.salonDurationMinutes)
        : undefined

      const mobilePriceIn = Object.prototype.hasOwnProperty.call(body, 'mobilePriceStartingAt')
        ? pickNullablePriceString(body.mobilePriceStartingAt)
        : undefined
      const mobileDurationIn = Object.prototype.hasOwnProperty.call(body, 'mobileDurationMinutes')
        ? pickNullablePositiveInt(body.mobileDurationMinutes)
        : undefined

      if (Object.prototype.hasOwnProperty.call(body, 'salonPriceStartingAt') && salonPriceIn === undefined) {
        return { kind: 'ERROR', status: 400, msg: 'salonPriceStartingAt must be string or null.' }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'salonDurationMinutes') && salonDurationIn === undefined) {
        return { kind: 'ERROR', status: 400, msg: 'Invalid salonDurationMinutes.' }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'mobilePriceStartingAt') && mobilePriceIn === undefined) {
        return { kind: 'ERROR', status: 400, msg: 'mobilePriceStartingAt must be string or null.' }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'mobileDurationMinutes') && mobileDurationIn === undefined) {
        return { kind: 'ERROR', status: 400, msg: 'Invalid mobileDurationMinutes.' }
      }

      let patchSalonDuration: number | undefined
      let patchSalonPrice: Prisma.Decimal | undefined

      if (!nextOffersInSalon) {
        data.salonPriceStartingAt = null
        data.salonDurationMinutes = null
      } else {
        if (salonDurationIn !== undefined) {
          if (salonDurationIn === null) {
            return {
              kind: 'ERROR',
              status: 400,
              msg: 'salonDurationMinutes cannot be null when Salon is enabled.',
            }
          }
          patchSalonDuration = salonDurationIn
          data.salonDurationMinutes = patchSalonDuration
        }

        if (salonPriceIn !== undefined) {
          if (salonPriceIn === null) {
            return {
              kind: 'ERROR',
              status: 400,
              msg: 'salonPriceStartingAt cannot be null when Salon is enabled.',
            }
          }

          try {
            patchSalonPrice = parsePriceOrThrow(salonPriceIn, existing.service.minPrice, 'Salon')
            data.salonPriceStartingAt = patchSalonPrice
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Invalid salon price.'
            return {
              kind: 'ERROR',
              status: 400,
              msg,
              extra: { minPrice: moneyToString(existing.service.minPrice) ?? '0.00' },
            }
          }
        }

        const finalSalonDuration = patchSalonDuration ?? existing.salonDurationMinutes
        const finalSalonPrice = patchSalonPrice ?? existing.salonPriceStartingAt

        if (!isPositiveIntValue(finalSalonDuration)) {
          return {
            kind: 'ERROR',
            status: 400,
            msg: 'Salon is enabled but salonDurationMinutes is missing/invalid.',
          }
        }

        if (!finalSalonPrice) {
          return {
            kind: 'ERROR',
            status: 400,
            msg: 'Salon is enabled but salonPriceStartingAt is missing.',
          }
        }
      }

      let patchMobileDuration: number | undefined
      let patchMobilePrice: Prisma.Decimal | undefined

      if (!nextOffersMobile) {
        data.mobilePriceStartingAt = null
        data.mobileDurationMinutes = null
      } else {
        if (mobileDurationIn !== undefined) {
          if (mobileDurationIn === null) {
            return {
              kind: 'ERROR',
              status: 400,
              msg: 'mobileDurationMinutes cannot be null when Mobile is enabled.',
            }
          }
          patchMobileDuration = mobileDurationIn
          data.mobileDurationMinutes = patchMobileDuration
        }

        if (mobilePriceIn !== undefined) {
          if (mobilePriceIn === null) {
            return {
              kind: 'ERROR',
              status: 400,
              msg: 'mobilePriceStartingAt cannot be null when Mobile is enabled.',
            }
          }

          try {
            patchMobilePrice = parsePriceOrThrow(mobilePriceIn, existing.service.minPrice, 'Mobile')
            data.mobilePriceStartingAt = patchMobilePrice
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Invalid mobile price.'
            return {
              kind: 'ERROR',
              status: 400,
              msg,
              extra: { minPrice: moneyToString(existing.service.minPrice) ?? '0.00' },
            }
          }
        }

        const finalMobileDuration = patchMobileDuration ?? existing.mobileDurationMinutes
        const finalMobilePrice = patchMobilePrice ?? existing.mobilePriceStartingAt

        if (!isPositiveIntValue(finalMobileDuration)) {
          return {
            kind: 'ERROR',
            status: 400,
            msg: 'Mobile is enabled but mobileDurationMinutes is missing/invalid.',
          }
        }

        if (!finalMobilePrice) {
          return {
            kind: 'ERROR',
            status: 400,
            msg: 'Mobile is enabled but mobilePriceStartingAt is missing.',
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'isActive')) {
        const isActiveIn = pickBoolean(body.isActive)
        if (isActiveIn === undefined) {
          return { kind: 'ERROR', status: 400, msg: 'isActive must be boolean.' }
        }
        data.isActive = isActiveIn
      }

      if (Object.keys(data).length === 0) {
        return { kind: 'OK', offering: existing }
      }

      const saved = await tx.professionalServiceOffering.update({
        where: { id: existing.id },
        data,
        include: {
          service: {
            include: {
              category: true,
            },
          },
        },
      })

      return { kind: 'OK', offering: saved }
    })

    if (result.kind === 'NOT_FOUND') {
      return jsonFail(404, 'Not found.')
    }

    if (result.kind === 'ERROR') {
      return jsonFail(result.status, result.msg, result.extra)
    }

    return jsonOk({ offering: toDto(result.offering) }, 200)
  } catch (error) {
    console.error('PATCH /api/pro/offerings/[id] error', error)
    return jsonFail(500, 'Internal server error.')
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const offeringId = trimId(params.id)
    if (!offeringId) {
      return jsonFail(400, 'Missing offering id.')
    }

    const existing = await prisma.professionalServiceOffering.findFirst({
      where: {
        id: offeringId,
        professionalId,
      },
      select: { id: true },
    })

    if (!existing) {
      return jsonFail(404, 'Not found.')
    }

    await prisma.professionalServiceOffering.update({
      where: { id: existing.id },
      data: { isActive: false },
    })

    return jsonOk({}, 200)
  } catch (error) {
    console.error('DELETE /api/pro/offerings/[id] error', error)
    return jsonFail(500, 'Internal server error.')
  }
}