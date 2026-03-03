// app/api/pro/offerings/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType } from '@prisma/client'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { parseMoney, moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

type JsonObject = Record<string, unknown>

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.trunc(n) === n && n > 0
}

function trimOrNull(v: unknown): string | null | undefined {
  // undefined => not provided / invalid type
  // null => explicit clear
  if (v === null) return null
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : null
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

function pickNullablePositiveInt(v: unknown): number | null | undefined {
  if (v === null) return null
  if (v === undefined) return undefined
  if (!isPositiveInt(v)) return undefined
  return v
}

type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type WorkingHoursDay = { enabled: boolean; start: string; end: string }
type WorkingHoursObj = Record<WeekdayKey, WorkingHoursDay>

function defaultWorkingHours(): Prisma.JsonObject {
  const make = (enabled: boolean): WorkingHoursDay => ({ enabled, start: '09:00', end: '17:00' })
  const v: WorkingHoursObj = {
    mon: make(true),
    tue: make(true),
    wed: make(true),
    thu: make(true),
    fri: make(true),
    sat: make(false),
    sun: make(false),
  }
  return v
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

async function ensureLocationsForOffering(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  ensureSalon: boolean
  ensureMobile: boolean
}) {
  const { tx, professionalId, ensureSalon, ensureMobile } = args

  const neededTypes: ProfessionalLocationType[] = []
  if (ensureSalon) neededTypes.push(ProfessionalLocationType.SALON)
  if (ensureMobile) neededTypes.push(ProfessionalLocationType.MOBILE_BASE)
  if (!neededTypes.length) return

  const existing = await tx.professionalLocation.findMany({
    where: { professionalId, type: { in: neededTypes } },
    select: { id: true, type: true },
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

// Optional: GET one offering (handy for debugging)
export async function GET(_request: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await ctx.params
    const offeringId = trimId(id)
    if (!offeringId) return jsonFail(400, 'Missing offering id.')

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId, isActive: true },
      include: { service: { include: { category: true } } },
    })

    if (!offering) return jsonFail(404, 'Not found.')

    return jsonOk({ offering }, 200)
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

    const { id } = await ctx.params
    const offeringId = trimId(id)
    if (!offeringId) return jsonFail(400, 'Missing offering id.')

    const raw: unknown = await request.json().catch(() => null)
    if (!isRecord(raw)) return jsonFail(400, 'Invalid JSON body.')
    const body = raw

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.professionalServiceOffering.findFirst({
        where: { id: offeringId, professionalId },
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

      // Read booleans (if present)
      const offersInSalonIn = Object.prototype.hasOwnProperty.call(body, 'offersInSalon')
        ? pickBoolean(body.offersInSalon)
        : undefined
      const offersMobileIn = Object.prototype.hasOwnProperty.call(body, 'offersMobile')
        ? pickBoolean(body.offersMobile)
        : undefined

      if (Object.prototype.hasOwnProperty.call(body, 'offersInSalon') && offersInSalonIn === undefined) {
        return { kind: 'ERROR' as const, status: 400, msg: 'offersInSalon must be boolean.' }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'offersMobile') && offersMobileIn === undefined) {
        return { kind: 'ERROR' as const, status: 400, msg: 'offersMobile must be boolean.' }
      }

      const nextOffersInSalon =
        typeof offersInSalonIn === 'boolean' ? offersInSalonIn : Boolean(existing.offersInSalon)
      const nextOffersMobile =
        typeof offersMobileIn === 'boolean' ? offersMobileIn : Boolean(existing.offersMobile)

      const serviceOk = Boolean(existing.service.isActive && existing.service.category?.isActive)

      // If upstream service/category disabled, only allow deactivation.
      if (!serviceOk) {
        const isActiveIn = Object.prototype.hasOwnProperty.call(body, 'isActive') ? pickBoolean(body.isActive) : undefined
        if (Object.prototype.hasOwnProperty.call(body, 'isActive') && isActiveIn === undefined) {
          return { kind: 'ERROR' as const, status: 400, msg: 'isActive must be boolean.' }
        }

        if (isActiveIn === false) {
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

      // If toggling a mode ON, ensure a placeholder location exists
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

      // simple fields
      const desc = Object.prototype.hasOwnProperty.call(body, 'description') ? trimOrNull(body.description) : undefined
      if (Object.prototype.hasOwnProperty.call(body, 'description') && desc === undefined) {
        return { kind: 'ERROR' as const, status: 400, msg: 'description must be string or null.' }
      }
      if (desc !== undefined) data.description = desc

      const img = Object.prototype.hasOwnProperty.call(body, 'customImageUrl') ? trimOrNull(body.customImageUrl) : undefined
      if (Object.prototype.hasOwnProperty.call(body, 'customImageUrl') && img === undefined) {
        return { kind: 'ERROR' as const, status: 400, msg: 'customImageUrl must be string or null.' }
      }
      if (img !== undefined) data.customImageUrl = img

      if (typeof offersInSalonIn === 'boolean') data.offersInSalon = nextOffersInSalon
      if (typeof offersMobileIn === 'boolean') data.offersMobile = nextOffersMobile

      // read price/duration inputs (if present)
      const salonPriceIn = Object.prototype.hasOwnProperty.call(body, 'salonPriceStartingAt')
        ? pickNullablePriceString(body.salonPriceStartingAt)
        : undefined
      const salonDurIn = Object.prototype.hasOwnProperty.call(body, 'salonDurationMinutes')
        ? pickNullablePositiveInt(body.salonDurationMinutes)
        : undefined

      const mobilePriceIn = Object.prototype.hasOwnProperty.call(body, 'mobilePriceStartingAt')
        ? pickNullablePriceString(body.mobilePriceStartingAt)
        : undefined
      const mobileDurIn = Object.prototype.hasOwnProperty.call(body, 'mobileDurationMinutes')
        ? pickNullablePositiveInt(body.mobileDurationMinutes)
        : undefined

      if (Object.prototype.hasOwnProperty.call(body, 'salonPriceStartingAt') && salonPriceIn === undefined) {
        return { kind: 'ERROR' as const, status: 400, msg: 'salonPriceStartingAt must be string or null.' }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'salonDurationMinutes') && salonDurIn === undefined) {
        return { kind: 'ERROR' as const, status: 400, msg: 'Invalid salonDurationMinutes.' }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'mobilePriceStartingAt') && mobilePriceIn === undefined) {
        return { kind: 'ERROR' as const, status: 400, msg: 'mobilePriceStartingAt must be string or null.' }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'mobileDurationMinutes') && mobileDurIn === undefined) {
        return { kind: 'ERROR' as const, status: 400, msg: 'Invalid mobileDurationMinutes.' }
      }

      // ---- SALON ----
      let patchSalonDur: number | undefined
      let patchSalonPrice: Prisma.Decimal | undefined

      if (!nextOffersInSalon) {
        data.salonPriceStartingAt = null
        data.salonDurationMinutes = null
      } else {
        if (salonDurIn !== undefined) {
          if (salonDurIn === null) {
            return { kind: 'ERROR' as const, status: 400, msg: 'salonDurationMinutes cannot be null when Salon is enabled.' }
          }
          patchSalonDur = salonDurIn
          data.salonDurationMinutes = patchSalonDur
        }

        if (salonPriceIn !== undefined) {
          if (salonPriceIn === null) {
            return { kind: 'ERROR' as const, status: 400, msg: 'salonPriceStartingAt cannot be null when Salon is enabled.' }
          }
          try {
            patchSalonPrice = parsePriceOrThrow(salonPriceIn, existing.service.minPrice, 'Salon')
            data.salonPriceStartingAt = patchSalonPrice
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Invalid salon price.'
            return {
              kind: 'ERROR' as const,
              status: 400,
              msg,
              extra: { minPrice: moneyToString(existing.service.minPrice) ?? '0.00' },
            }
          }
        }

        const finalSalonDuration = patchSalonDur ?? existing.salonDurationMinutes
        const finalSalonPrice = patchSalonPrice ?? existing.salonPriceStartingAt

        if (!isPositiveInt(finalSalonDuration)) {
          return { kind: 'ERROR' as const, status: 400, msg: 'Salon is enabled but salonDurationMinutes is missing/invalid.' }
        }
        if (!finalSalonPrice) {
          return { kind: 'ERROR' as const, status: 400, msg: 'Salon is enabled but salonPriceStartingAt is missing.' }
        }
      }

      // ---- MOBILE ----
      let patchMobileDur: number | undefined
      let patchMobilePrice: Prisma.Decimal | undefined

      if (!nextOffersMobile) {
        data.mobilePriceStartingAt = null
        data.mobileDurationMinutes = null
      } else {
        if (mobileDurIn !== undefined) {
          if (mobileDurIn === null) {
            return { kind: 'ERROR' as const, status: 400, msg: 'mobileDurationMinutes cannot be null when Mobile is enabled.' }
          }
          patchMobileDur = mobileDurIn
          data.mobileDurationMinutes = patchMobileDur
        }

        if (mobilePriceIn !== undefined) {
          if (mobilePriceIn === null) {
            return { kind: 'ERROR' as const, status: 400, msg: 'mobilePriceStartingAt cannot be null when Mobile is enabled.' }
          }
          try {
            patchMobilePrice = parsePriceOrThrow(mobilePriceIn, existing.service.minPrice, 'Mobile')
            data.mobilePriceStartingAt = patchMobilePrice
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Invalid mobile price.'
            return {
              kind: 'ERROR' as const,
              status: 400,
              msg,
              extra: { minPrice: moneyToString(existing.service.minPrice) ?? '0.00' },
            }
          }
        }

        const finalMobileDuration = patchMobileDur ?? existing.mobileDurationMinutes
        const finalMobilePrice = patchMobilePrice ?? existing.mobilePriceStartingAt

        if (!isPositiveInt(finalMobileDuration)) {
          return { kind: 'ERROR' as const, status: 400, msg: 'Mobile is enabled but mobileDurationMinutes is missing/invalid.' }
        }
        if (!finalMobilePrice) {
          return { kind: 'ERROR' as const, status: 400, msg: 'Mobile is enabled but mobilePriceStartingAt is missing.' }
        }
      }

      // isActive
      if (Object.prototype.hasOwnProperty.call(body, 'isActive')) {
        const v = pickBoolean(body.isActive)
        if (v === undefined) return { kind: 'ERROR' as const, status: 400, msg: 'isActive must be boolean.' }
        data.isActive = v
      }

      if (Object.keys(data).length === 0) {
        // no changes
        return { kind: 'OK' as const, offering: existing }
      }

      const saved = await tx.professionalServiceOffering.update({
        where: { id: existing.id },
        data,
        include: { service: { include: { category: true } } },
      })

      return { kind: 'OK' as const, offering: saved }
    })

    if (result.kind === 'NOT_FOUND') return jsonFail(404, 'Not found.')
    if (result.kind === 'ERROR') return jsonFail(result.status, result.msg, result.extra)

    return jsonOk({ offering: result.offering }, 200)
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

    const { id } = await ctx.params
    const offeringId = trimId(id)
    if (!offeringId) return jsonFail(400, 'Missing offering id.')

    const existing = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId },
      select: { id: true },
    })
    if (!existing) return jsonFail(404, 'Not found.')

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