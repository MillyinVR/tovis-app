// lib/lastMinutePricing.ts
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'

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

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.min(50, Math.max(0, Math.trunc(n)))
}

function isWithinBlockedRange(scheduledFor: Date, startAt: Date, endAt: Date) {
  // block is [startAt, endAt)
  return scheduledFor >= startAt && scheduledFor < endAt
}

function weekdayIndexInTimeZone(d: Date, timeZone: string): number {
  // Returns 0..6 where 0=Sun ... 6=Sat
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)
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

function sameDayInTimeZone(a: Date, b: Date, timeZone: string): boolean {
  const tz = sanitizeTimeZone(timeZone, 'UTC')

  const partsA = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(a)

  const partsB = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(b)

  return partsA === partsB
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

  const [settings, pro] = await Promise.all([
    prisma.lastMinuteSettings.findUnique({
      where: { professionalId },
      include: { serviceRules: true, blocks: true },
    }),
    prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { timeZone: true },
    }),
  ])

  // If you ever allow last-minute for multi-location, replace this with the service/location tz.
  const timeZone = sanitizeTimeZone(pro?.timeZone ?? 'UTC', 'UTC')

  // Last-minute off entirely
  if (!settings?.enabled) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: null }
  }

  // On, but discounts off
  if (!settings.discountsEnabled) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: null }
  }

  const now = new Date()
  const ms = scheduledFor.getTime() - now.getTime()
  if (!Number.isFinite(ms) || ms < 0) {
    return { discountAmount: 0, discountedPrice: basePrice, appliedPct: 0, window: null, reason: 'Past time' }
  }

  // Day disables (in PRO timezone)
  const day = weekdayIndexInTimeZone(scheduledFor, timeZone) // 0 Sun ... 6 Sat
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

  // Blocked ranges (instants, UTC-safe)
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

  // SAME_DAY must be based on PRO timezone day boundary
  if (sameDayInTimeZone(scheduledFor, now, timeZone)) {
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
