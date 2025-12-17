// lib/lastMinutePricing.ts
import { prisma } from '@/lib/prisma'

export type LastMinuteWindow = 'SAME_DAY' | 'WITHIN_24H' | null

export type PriceResult = {
  discountAmount: number
  discountedPrice: number
  appliedPct: number
  window: LastMinuteWindow
  reason: string | null
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100
}

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.min(50, Math.max(0, Math.trunc(n)))
}

function isWithinBlockedRange(scheduledFor: Date, startAt: Date, endAt: Date) {
  // block is [startAt, endAt)
  return scheduledFor >= startAt && scheduledFor < endAt
}

export async function computeLastMinuteDiscount(args: {
  professionalId: string
  serviceId: string
  scheduledFor: Date
  basePrice: number
}): Promise<PriceResult> {
  const { professionalId, serviceId, scheduledFor } = args
  const basePrice = Number(args.basePrice)

  if (!Number.isFinite(basePrice) || basePrice < 0) {
    return { discountAmount: 0, discountedPrice: 0, appliedPct: 0, window: null, reason: 'Invalid base price' }
  }

  const settings = await prisma.lastMinuteSettings.findUnique({
    where: { professionalId },
    include: { serviceRules: true, blocks: true },
  })

  // Last-minute feature off entirely
  if (!settings?.enabled) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: null }
  }

  // Feature can be on, discounts can be off (your new toggle)
  if (!settings.discountsEnabled) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: null }
  }

  const now = new Date()
  const ms = scheduledFor.getTime() - now.getTime()
  if (!Number.isFinite(ms) || ms < 0) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: 'Past time' }
  }

  // Day disables
  const day = scheduledFor.getDay() // 0 Sun ... 6 Sat
  const dayDisabled =
    (day === 1 && settings.disableMon) ||
    (day === 2 && settings.disableTue) ||
    (day === 3 && settings.disableWed) ||
    (day === 4 && settings.disableThu) ||
    (day === 5 && settings.disableFri) ||
    (day === 6 && settings.disableSat) ||
    (day === 0 && settings.disableSun)

  if (dayDisabled) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: 'Day disabled' }
  }

  // Blocked time ranges
  const isBlocked = settings.blocks.some((b) => {
    const startAt = b.startAt instanceof Date ? b.startAt : new Date(b.startAt as any)
    const endAt = b.endAt instanceof Date ? b.endAt : new Date(b.endAt as any)
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return false
    return isWithinBlockedRange(scheduledFor, startAt, endAt)
  })

  if (isBlocked) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: 'Blocked slot' }
  }

  // Service rule: must be enabled
  const rule = settings.serviceRules.find((r) => r.serviceId === serviceId)
  if (rule && rule.enabled === false) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: 'Service disabled' }
  }

  // Min price checks (service overrides global)
  const globalMin = settings.minPrice != null ? Number(settings.minPrice) : null
  const serviceMin = rule?.minPrice != null ? Number(rule.minPrice) : null
  const minRequired = serviceMin ?? globalMin

  if (minRequired != null && Number.isFinite(minRequired) && basePrice < minRequired) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: 'Below min price' }
  }

  // Windows
  const hours = ms / (1000 * 60 * 60)
  const sameDayPct = clampPct(settings.windowSameDayPct)
  const within24Pct = clampPct(settings.window24hPct)

  let pct = 0
  let window: LastMinuteWindow = null

  if (sameLocalDay(scheduledFor, now)) {
    pct = sameDayPct
    window = pct > 0 ? 'SAME_DAY' : null
  } else if (hours <= 24) {
    pct = within24Pct
    window = pct > 0 ? 'WITHIN_24H' : null
  }

  if (!pct || pct <= 0 || !window) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: null }
  }

  const discountAmount = roundMoney(basePrice * (pct / 100))
  const discountedPrice = Math.max(0, roundMoney(basePrice - discountAmount))

  return { discountAmount, discountedPrice, appliedPct: pct, window, reason: null }
}
