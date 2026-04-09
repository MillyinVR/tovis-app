// lib/lastMinutePricing.ts
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { LastMinuteOfferType, Prisma } from '@prisma/client'

/**
 * Legacy name kept for caller compatibility.
 *
 * Important:
 * - Last-minute pricing is NO LONGER inferred from settings-level auto windows.
 * - Settings now gate eligibility and floor protection only.
 * - Any monetary incentive must be passed in explicitly from the opening/tier truth.
 */
export type LastMinuteWindow = 'OPENING_TIER' | null

export type PriceResult = {
  discountAmount: number
  discountedPrice: number
  appliedPct: number
  window: LastMinuteWindow
  reason: string | null
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(99, Math.max(0, Math.trunc(n)))
}

function isWithinBlockedRange(scheduledFor: Date, startAt: Date, endAt: Date): boolean {
  return scheduledFor >= startAt && scheduledFor < endAt
}

function weekdayIndexInTimeZone(d: Date, timeZone: string): number {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).format(d)

  switch (wd) {
    case 'Sun':
      return 0
    case 'Mon':
      return 1
    case 'Tue':
      return 2
    case 'Wed':
      return 3
    case 'Thu':
      return 4
    case 'Fri':
      return 5
    case 'Sat':
      return 6
    default:
      return 0
  }
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (!value) return null
  const n = Number(value.toString())
  return Number.isFinite(n) ? n : null
}

function parseAmountOff(
  value: Prisma.Decimal | number | string | null | undefined,
): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const n = Number(value.trim())
    return Number.isFinite(n) ? n : null
  }

  const n = Number(value.toString())
  return Number.isFinite(n) ? n : null
}

function discountedPriceForPercent(basePrice: number, percentOff: number): number {
  return roundMoney(basePrice * (1 - percentOff / 100))
}

function discountedPriceForAmount(basePrice: number, amountOff: number): number {
  return roundMoney(basePrice - amountOff)
}

export async function computeLastMinuteDiscount(args: {
  professionalId: string
  serviceId: string
  scheduledFor: Date
  basePrice: number
  timeZone: string

  /**
   * New explicit offer truth.
   * If omitted, this helper returns no automatic discount.
   */
  offerType?: LastMinuteOfferType | null
  percentOff?: number | null
  amountOff?: Prisma.Decimal | number | string | null
}): Promise<PriceResult> {
  const { professionalId, serviceId, scheduledFor } = args
  const basePrice = Number(args.basePrice)

  if (!Number.isFinite(basePrice) || basePrice < 0) {
    return {
      discountAmount: 0,
      discountedPrice: 0,
      appliedPct: 0,
      window: null,
      reason: 'Invalid base price',
    }
  }

  const settings = await prisma.lastMinuteSettings.findUnique({
    where: { professionalId },
    include: { serviceRules: true, blocks: true },
  })

  const timeZone = sanitizeTimeZone(args.timeZone, 'UTC')

  if (!settings?.enabled) {
    return {
      discountAmount: 0,
      discountedPrice: basePrice,
      appliedPct: 0,
      window: null,
      reason: null,
    }
  }

  const now = new Date()
  const ms = scheduledFor.getTime() - now.getTime()
  if (!Number.isFinite(ms) || ms < 0) {
    return {
      discountAmount: 0,
      discountedPrice: basePrice,
      appliedPct: 0,
      window: null,
      reason: 'Past time',
    }
  }

  const day = weekdayIndexInTimeZone(scheduledFor, timeZone)
  const dayDisabled =
    (day === 1 && settings.disableMon) ||
    (day === 2 && settings.disableTue) ||
    (day === 3 && settings.disableWed) ||
    (day === 4 && settings.disableThu) ||
    (day === 5 && settings.disableFri) ||
    (day === 6 && settings.disableSat) ||
    (day === 0 && settings.disableSun)

  if (dayDisabled) {
    return {
      discountAmount: 0,
      discountedPrice: basePrice,
      appliedPct: 0,
      window: null,
      reason: 'Day disabled',
    }
  }

  const isBlocked = settings.blocks.some((block) =>
    isWithinBlockedRange(scheduledFor, block.startAt, block.endAt),
  )

  if (isBlocked) {
    return {
      discountAmount: 0,
      discountedPrice: basePrice,
      appliedPct: 0,
      window: null,
      reason: 'Blocked slot',
    }
  }

  const rule = settings.serviceRules.find((r) => r.serviceId === serviceId)
  if (rule && rule.enabled === false) {
    return {
      discountAmount: 0,
      discountedPrice: basePrice,
      appliedPct: 0,
      window: null,
      reason: 'Service disabled',
    }
  }

  const globalMinCollectedSubtotal = decimalToNumber(settings.minCollectedSubtotal)
  const serviceMinCollectedSubtotal = decimalToNumber(rule?.minCollectedSubtotal)
  const minCollectedSubtotal =
    serviceMinCollectedSubtotal ?? globalMinCollectedSubtotal

  if (
    minCollectedSubtotal != null &&
    Number.isFinite(minCollectedSubtotal) &&
    basePrice < minCollectedSubtotal
  ) {
    return {
      discountAmount: 0,
      discountedPrice: basePrice,
      appliedPct: 0,
      window: null,
      reason: 'Below minimum collected subtotal',
    }
  }

  const offerType = args.offerType ?? LastMinuteOfferType.NONE

  if (
    offerType === LastMinuteOfferType.NONE ||
    offerType === LastMinuteOfferType.FREE_ADD_ON
  ) {
    return {
      discountAmount: 0,
      discountedPrice: basePrice,
      appliedPct: 0,
      window: null,
      reason: null,
    }
  }

  if (offerType === LastMinuteOfferType.FREE_SERVICE) {
    return {
      discountAmount: roundMoney(basePrice),
      discountedPrice: 0,
      appliedPct: 0,
      window: 'OPENING_TIER',
      reason: null,
    }
  }

  if (offerType === LastMinuteOfferType.PERCENT_OFF) {
    const pct = clampPct(Number(args.percentOff ?? 0))
    if (pct <= 0) {
      return {
        discountAmount: 0,
        discountedPrice: basePrice,
        appliedPct: 0,
        window: null,
        reason: 'Invalid percent-off offer',
      }
    }

    const discountedPrice = discountedPriceForPercent(basePrice, pct)

    if (
      minCollectedSubtotal != null &&
      Number.isFinite(minCollectedSubtotal) &&
      discountedPrice < minCollectedSubtotal
    ) {
      return {
        discountAmount: 0,
        discountedPrice: basePrice,
        appliedPct: 0,
        window: null,
        reason: 'Discount violates minimum collected subtotal',
      }
    }

    const discountAmount = roundMoney(basePrice - discountedPrice)

    return {
      discountAmount,
      discountedPrice,
      appliedPct: pct,
      window: 'OPENING_TIER',
      reason: null,
    }
  }

  if (offerType === LastMinuteOfferType.AMOUNT_OFF) {
    const amountOff = parseAmountOff(args.amountOff)
    if (amountOff == null || !Number.isFinite(amountOff) || amountOff <= 0) {
      return {
        discountAmount: 0,
        discountedPrice: basePrice,
        appliedPct: 0,
        window: null,
        reason: 'Invalid amount-off offer',
      }
    }

    if (amountOff >= basePrice) {
      return {
        discountAmount: 0,
        discountedPrice: basePrice,
        appliedPct: 0,
        window: null,
        reason: 'Amount-off must be less than base price',
      }
    }

    const discountedPrice = discountedPriceForAmount(basePrice, amountOff)

    if (
      minCollectedSubtotal != null &&
      Number.isFinite(minCollectedSubtotal) &&
      discountedPrice < minCollectedSubtotal
    ) {
      return {
        discountAmount: 0,
        discountedPrice: basePrice,
        appliedPct: 0,
        window: null,
        reason: 'Discount violates minimum collected subtotal',
      }
    }

    return {
      discountAmount: roundMoney(amountOff),
      discountedPrice,
      appliedPct: 0,
      window: 'OPENING_TIER',
      reason: null,
    }
  }

  return {
    discountAmount: 0,
    discountedPrice: basePrice,
    appliedPct: 0,
    window: null,
    reason: 'Unsupported last-minute offer type',
  }
}