// lib/analytics/proMonthlyAnalytics.ts
import 'server-only'

import { BookingSource, BookingStatus, Prisma } from '@prisma/client'

import { moneyToCentsInt, moneyToFixed2String, moneyToString } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import {
  DEFAULT_TIME_ZONE,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
} from '@/lib/timeZone'

export type ProOverviewSearchParams = {
  [key: string]: string | string[] | undefined
}

export type ProOverviewTrendTone = 'positive' | 'negative' | 'neutral'

export type ProOverviewMonthNavItem = {
  key: string
  label: string
  href: string
  active: boolean
}

export type ProOverviewMetricItem = {
  label: string
  value: string
  sub: string
}

export type ProOverviewTopServiceItem = {
  id: string
  name: string
  bookings: number
  revenueLabel: string
}

export type ProOverviewPageData = {
  activeMonth: {
    key: string
    label: string
    timeZone: string
  }
  months: ProOverviewMonthNavItem[]
  revenue: {
    value: string
    trendLabel: string
    trendTone: ProOverviewTrendTone
    sub: string
  }
  primaryStats: ProOverviewMetricItem[]
  secondaryStats: ProOverviewMetricItem[]
  topServices: ProOverviewTopServiceItem[]
}

type MonthParts = {
  y: number
  m: number
}

type BuiltServiceAnalytics = {
  serviceId: string
  serviceNameSnapshot: string
  bookingCount: number
  revenueCents: number
  rank: number
}

type BuiltProductAnalytics = {
  productId: string
  productNameSnapshot: string
  quantity: number
  revenueCents: number
  rank: number
}

type BuiltMonthlyAnalytics = {
  serviceRevenueCents: number
  productRevenueCents: number
  revenueTotalCents: number
  tipCents: number

  completedBookingCount: number

  uniqueClientCount: number
  newClientCount: number
  repeatClientCount: number
  futureRebookedClientCount: number
  noFutureRebookClientCount: number

  requestedNewBookingCount: number
  requestedRepeatBookingCount: number
  discoveryNewBookingCount: number
  discoveryRepeatBookingCount: number
  aftercareBookingCount: number

  reviewCount: number
  ratingSum: number
  averageRating: Prisma.Decimal | null

  services: BuiltServiceAnalytics[]
  products: BuiltProductAnalytics[]
}

const TOP_SERVICE_LIMIT = 10
const TOP_PRODUCT_LIMIT = 10
const OVERVIEW_MONTH_NAV_COUNT = 4

function firstParamValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseMonthKey(monthKey: string): MonthParts | null {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null

  const [yearRaw, monthRaw] = monthKey.split('-')
  const y = Number(yearRaw)
  const m = Number(monthRaw)

  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null
  if (!Number.isInteger(m) || m < 1 || m > 12) return null

  return { y, m }
}

function requireMonthKey(monthKey: string): MonthParts {
  const parsed = parseMonthKey(monthKey)

  if (!parsed) {
    throw new Error(`Invalid analytics month key: ${monthKey}`)
  }

  return parsed
}

function parseMonthParam(raw: string | string[] | undefined): MonthParts | null {
  const value = firstParamValue(raw)
  return value ? parseMonthKey(value) : null
}

export function monthKey(parts: MonthParts): string {
  return `${parts.y}-${String(parts.m).padStart(2, '0')}`
}

function addMonths(parts: MonthParts, delta: number): MonthParts {
  const date = new Date(Date.UTC(parts.y, parts.m - 1 + delta, 1, 12, 0, 0))

  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
  }
}

function monthLabel(parts: MonthParts, timeZone: string): string {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  const date = new Date(Date.UTC(parts.y, parts.m - 1, 1, 12, 0, 0))

  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function currentYearMonthInTimeZone(now: Date, timeZone: string): MonthParts {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)

  const values: Record<string, string> = {}

  for (const part of parts) {
    values[part.type] = part.value
  }

  const y = Number(values.year)
  const m = Number(values.month)

  if (
    Number.isInteger(y) &&
    y > 0 &&
    Number.isInteger(m) &&
    m >= 1 &&
    m <= 12
  ) {
    return { y, m }
  }

  return {
    y: now.getUTCFullYear(),
    m: now.getUTCMonth() + 1,
  }
}

function monthWindowUtcForProTimeZone(args: {
  month: MonthParts
  timeZone: string
}): {
  periodStartUtc: Date
  periodEndUtc: Date
} {
  const tz = sanitizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)

  const anchorThisMonth = new Date(
    Date.UTC(args.month.y, args.month.m - 1, 1, 12, 0, 0),
  )

  const anchorNextMonth = new Date(
    Date.UTC(args.month.y, args.month.m, 1, 12, 0, 0),
  )

  return {
    periodStartUtc: startOfDayUtcInTimeZone(anchorThisMonth, tz),
    periodEndUtc: startOfDayUtcInTimeZone(anchorNextMonth, tz),
  }
}

function normalizeCount(value: number | null | undefined): number {
  if (typeof value !== 'number') return 0
  if (!Number.isFinite(value)) return 0

  return Math.max(0, Math.trunc(value))
}

function decimalToCents(value: Prisma.Decimal | null | undefined): number {
  const fixed = moneyToFixed2String(value)
  if (!fixed) return 0

  return moneyToCentsInt(fixed) ?? 0
}

function centsToMoneyLabel(cents: number): string {
  const normalizedCents = Math.trunc(cents)
  const label = moneyToString((normalizedCents / 100).toFixed(2)) ?? '0'

  return `$${label}`
}

function percentLabel(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%'

  return `${Math.round((numerator / denominator) * 100)}%`
}

function revenueTrend(args: {
  currentCents: number
  previousCents: number
}): {
  label: string
  tone: ProOverviewTrendTone
} {
  if (args.previousCents <= 0) {
    if (args.currentCents > 0) {
      return {
        label: 'New',
        tone: 'positive',
      }
    }

    return {
      label: '0%',
      tone: 'neutral',
    }
  }

  const deltaPct = Math.round(
    ((args.currentCents - args.previousCents) / args.previousCents) * 100,
  )

  if (deltaPct > 0) {
    return {
      label: `+${deltaPct}%`,
      tone: 'positive',
    }
  }

  if (deltaPct < 0) {
    return {
      label: `${deltaPct}%`,
      tone: 'negative',
    }
  }

  return {
    label: '0%',
    tone: 'neutral',
  }
}

function ratingLabel(value: Prisma.Decimal | null): string {
  if (!value) return '—'

  const rating = value.toNumber()
  if (!Number.isFinite(rating)) return '—'

  return rating.toFixed(1).replace(/\.0$/, '')
}

function buildMonthNav(args: {
  activeMonth: MonthParts
  timeZone: string
}): ProOverviewMonthNavItem[] {
  const start = addMonths(args.activeMonth, -(OVERVIEW_MONTH_NAV_COUNT - 1))

  return Array.from({ length: OVERVIEW_MONTH_NAV_COUNT }, (_, index) => {
    const month = addMonths(start, index)
    const key = monthKey(month)

    return {
      key,
      label: monthLabel(month, args.timeZone),
      href: `/pro/dashboard?month=${key}`,
      active: key === monthKey(args.activeMonth),
    }
  })
}

async function buildMonthlyAnalytics(args: {
  professionalId: string
  periodStartUtc: Date
  periodEndUtc: Date
}): Promise<BuiltMonthlyAnalytics> {
  const completedBookingWhere = {
    professionalId: args.professionalId,
    scheduledFor: {
      gte: args.periodStartUtc,
      lt: args.periodEndUtc,
    },
    status: BookingStatus.COMPLETED,
  } satisfies Prisma.BookingWhereInput

  const [
    bookingMoney,
    bookingClientSourceRows,
    currentClientRows,
    serviceGroups,
    reviewAgg,
    productSales,
  ] = await Promise.all([
    prisma.booking.aggregate({
      where: completedBookingWhere,
      _count: {
        _all: true,
      },
      _sum: {
        subtotalSnapshot: true,
        tipAmount: true,
      },
    }),

    prisma.booking.findMany({
      where: completedBookingWhere,
      select: {
        clientId: true,
        source: true,
      },
    }),

    prisma.booking.findMany({
      where: completedBookingWhere,
      distinct: ['clientId'],
      select: {
        clientId: true,
      },
    }),

    prisma.booking.groupBy({
      by: ['serviceId'],
      where: completedBookingWhere,
      _count: {
        _all: true,
      },
      _sum: {
        subtotalSnapshot: true,
      },
    }),

    prisma.review.aggregate({
      where: {
        professionalId: args.professionalId,
        createdAt: {
          gte: args.periodStartUtc,
          lt: args.periodEndUtc,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        rating: true,
      },
    }),

    prisma.productSale.findMany({
      where: {
        professionalId: args.professionalId,
        createdAt: {
          gte: args.periodStartUtc,
          lt: args.periodEndUtc,
        },
      },
      select: {
        productId: true,
        quantity: true,
        unitPrice: true,
      },
    }),
  ])

  const clientIds = currentClientRows.map((row) => row.clientId)

  const [priorCompletedRows, futureBookingRows] =
    clientIds.length > 0
      ? await Promise.all([
          prisma.booking.findMany({
            where: {
              professionalId: args.professionalId,
              clientId: {
                in: clientIds,
              },
              status: BookingStatus.COMPLETED,
              scheduledFor: {
                lt: args.periodStartUtc,
              },
            },
            select: {
              clientId: true,
            },
          }),

          prisma.booking.findMany({
            where: {
              professionalId: args.professionalId,
              clientId: {
                in: clientIds,
              },
              scheduledFor: {
                gte: args.periodEndUtc,
              },
              status: {
                not: BookingStatus.CANCELLED,
              },
            },
            select: {
              clientId: true,
            },
          }),
        ])
      : [[], []]

  const priorClientIds = new Set(priorCompletedRows.map((row) => row.clientId))
  const futureClientIds = new Set(futureBookingRows.map((row) => row.clientId))

  const newClientCount = clientIds.filter(
    (clientId) => !priorClientIds.has(clientId),
  ).length

  const repeatClientCount = clientIds.filter((clientId) =>
    priorClientIds.has(clientId),
  ).length

  const futureRebookedClientCount = clientIds.filter((clientId) =>
    futureClientIds.has(clientId),
  ).length

  let requestedNewBookingCount = 0
  let requestedRepeatBookingCount = 0
  let discoveryNewBookingCount = 0
  let discoveryRepeatBookingCount = 0
  let aftercareBookingCount = 0

  for (const booking of bookingClientSourceRows) {
    const isRepeatClient = priorClientIds.has(booking.clientId)

    if (booking.source === BookingSource.AFTERCARE) {
      aftercareBookingCount += 1
    } else if (booking.source === BookingSource.REQUESTED) {
      if (isRepeatClient) {
        requestedRepeatBookingCount += 1
      } else {
        requestedNewBookingCount += 1
      }
    } else if (booking.source === BookingSource.DISCOVERY) {
      if (isRepeatClient) {
        discoveryRepeatBookingCount += 1
      } else {
        discoveryNewBookingCount += 1
      }
    }
  }

  const serviceIds = serviceGroups.map((group) => group.serviceId)

  const serviceNameRows =
    serviceIds.length > 0
      ? await prisma.service.findMany({
          where: {
            id: {
              in: serviceIds,
            },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : []

  const serviceNameById = new Map(
    serviceNameRows.map((service) => [service.id, service.name]),
  )

  const services = serviceGroups
    .map((group) => ({
      serviceId: group.serviceId,
      serviceNameSnapshot:
        serviceNameById.get(group.serviceId) ?? 'Unknown service',
      bookingCount: normalizeCount(group._count._all),
      revenueCents: decimalToCents(group._sum.subtotalSnapshot),
      rank: 0,
    }))
    .sort((left, right) => {
      const bookingDelta = right.bookingCount - left.bookingCount
      if (bookingDelta !== 0) return bookingDelta

      const revenueDelta = right.revenueCents - left.revenueCents
      if (revenueDelta !== 0) return revenueDelta

      return left.serviceNameSnapshot.localeCompare(right.serviceNameSnapshot)
    })
    .slice(0, TOP_SERVICE_LIMIT)
    .map((service, index) => ({
      ...service,
      rank: index + 1,
    }))

  const productTotals = new Map<
    string,
    {
      quantity: number
      revenueCents: number
    }
  >()

  for (const sale of productSales) {
    const quantity = normalizeCount(sale.quantity)
    const revenueCents = decimalToCents(sale.unitPrice) * quantity

    const current = productTotals.get(sale.productId) ?? {
      quantity: 0,
      revenueCents: 0,
    }

    productTotals.set(sale.productId, {
      quantity: current.quantity + quantity,
      revenueCents: current.revenueCents + revenueCents,
    })
  }

  const productIds = Array.from(productTotals.keys())

  const productNameRows =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: {
            id: {
              in: productIds,
            },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : []

  const productNameById = new Map(
    productNameRows.map((product) => [product.id, product.name]),
  )

  const products = Array.from(productTotals.entries())
    .map(([productId, totals]) => ({
      productId,
      productNameSnapshot: productNameById.get(productId) ?? 'Unknown product',
      quantity: totals.quantity,
      revenueCents: totals.revenueCents,
      rank: 0,
    }))
    .sort((left, right) => {
      const quantityDelta = right.quantity - left.quantity
      if (quantityDelta !== 0) return quantityDelta

      const revenueDelta = right.revenueCents - left.revenueCents
      if (revenueDelta !== 0) return revenueDelta

      return left.productNameSnapshot.localeCompare(right.productNameSnapshot)
    })
    .slice(0, TOP_PRODUCT_LIMIT)
    .map((product, index) => ({
      ...product,
      rank: index + 1,
    }))

  const serviceRevenueCents = decimalToCents(bookingMoney._sum.subtotalSnapshot)
  const productRevenueCents = products.reduce(
    (sum, product) => sum + product.revenueCents,
    0,
  )
  const revenueTotalCents = serviceRevenueCents + productRevenueCents
  const tipCents = decimalToCents(bookingMoney._sum.tipAmount)

  const reviewCount = normalizeCount(reviewAgg._count._all)
  const ratingSum = normalizeCount(reviewAgg._sum.rating)

  const averageRating =
    reviewCount > 0
      ? new Prisma.Decimal((ratingSum / reviewCount).toFixed(2))
      : null

  return {
    serviceRevenueCents,
    productRevenueCents,
    revenueTotalCents,
    tipCents,

    completedBookingCount: normalizeCount(bookingMoney._count._all),

    uniqueClientCount: clientIds.length,
    newClientCount,
    repeatClientCount,
    futureRebookedClientCount,
    noFutureRebookClientCount:
      clientIds.length - futureRebookedClientCount,

    requestedNewBookingCount,
    requestedRepeatBookingCount,
    discoveryNewBookingCount,
    discoveryRepeatBookingCount,
    aftercareBookingCount,

    reviewCount,
    ratingSum,
    averageRating,

    services,
    products,
  }
}

export async function readProfessionalMonthlyAnalytics(args: {
  professionalId: string
  monthKey: string
}) {
  return prisma.professionalMonthlyAnalytics.findUnique({
    where: {
      professionalId_monthKey: {
        professionalId: args.professionalId,
        monthKey: args.monthKey,
      },
    },
    include: {
      services: {
        orderBy: {
          rank: 'asc',
        },
        take: TOP_SERVICE_LIMIT,
      },
      products: {
        orderBy: {
          rank: 'asc',
        },
        take: TOP_PRODUCT_LIMIT,
      },
    },
  })
}

export type ProfessionalMonthlyAnalyticsSnapshot = NonNullable<
  Awaited<ReturnType<typeof readProfessionalMonthlyAnalytics>>
>

export async function recomputeProfessionalMonthlyAnalytics(args: {
  professionalId: string
  monthKey: string
  timeZone: string | null | undefined
}): Promise<ProfessionalMonthlyAnalyticsSnapshot> {
  const month = requireMonthKey(args.monthKey)
  const timeZone = sanitizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)
  const { periodStartUtc, periodEndUtc } = monthWindowUtcForProTimeZone({
    month,
    timeZone,
  })

  const stats = await buildMonthlyAnalytics({
    professionalId: args.professionalId,
    periodStartUtc,
    periodEndUtc,
  })

  await prisma.$transaction(async (tx) => {
    const analytics = await tx.professionalMonthlyAnalytics.upsert({
      where: {
        professionalId_monthKey: {
          professionalId: args.professionalId,
          monthKey: args.monthKey,
        },
      },
      create: {
        professionalId: args.professionalId,
        monthKey: args.monthKey,
        timeZone,
        periodStartUtc,
        periodEndUtc,

        serviceRevenueCents: stats.serviceRevenueCents,
        productRevenueCents: stats.productRevenueCents,
        revenueTotalCents: stats.revenueTotalCents,
        tipCents: stats.tipCents,

        completedBookingCount: stats.completedBookingCount,

        uniqueClientCount: stats.uniqueClientCount,
        newClientCount: stats.newClientCount,
        repeatClientCount: stats.repeatClientCount,
        futureRebookedClientCount: stats.futureRebookedClientCount,
        noFutureRebookClientCount: stats.noFutureRebookClientCount,

        requestedNewBookingCount: stats.requestedNewBookingCount,
        requestedRepeatBookingCount: stats.requestedRepeatBookingCount,
        discoveryNewBookingCount: stats.discoveryNewBookingCount,
        discoveryRepeatBookingCount: stats.discoveryRepeatBookingCount,
        aftercareBookingCount: stats.aftercareBookingCount,

        reviewCount: stats.reviewCount,
        ratingSum: stats.ratingSum,
        averageRating: stats.averageRating,
        computedAt: new Date(),
      },
      update: {
        timeZone,
        periodStartUtc,
        periodEndUtc,

        serviceRevenueCents: stats.serviceRevenueCents,
        productRevenueCents: stats.productRevenueCents,
        revenueTotalCents: stats.revenueTotalCents,
        tipCents: stats.tipCents,

        completedBookingCount: stats.completedBookingCount,

        uniqueClientCount: stats.uniqueClientCount,
        newClientCount: stats.newClientCount,
        repeatClientCount: stats.repeatClientCount,
        futureRebookedClientCount: stats.futureRebookedClientCount,
        noFutureRebookClientCount: stats.noFutureRebookClientCount,

        requestedNewBookingCount: stats.requestedNewBookingCount,
        requestedRepeatBookingCount: stats.requestedRepeatBookingCount,
        discoveryNewBookingCount: stats.discoveryNewBookingCount,
        discoveryRepeatBookingCount: stats.discoveryRepeatBookingCount,
        aftercareBookingCount: stats.aftercareBookingCount,

        reviewCount: stats.reviewCount,
        ratingSum: stats.ratingSum,
        averageRating: stats.averageRating,
        computedAt: new Date(),
      },
    })

    await tx.professionalMonthlyServiceAnalytics.deleteMany({
      where: {
        analyticsId: analytics.id,
      },
    })

    await tx.professionalMonthlyProductAnalytics.deleteMany({
      where: {
        analyticsId: analytics.id,
      },
    })

    if (stats.services.length > 0) {
      await tx.professionalMonthlyServiceAnalytics.createMany({
        data: stats.services.map((service) => ({
          analyticsId: analytics.id,
          serviceId: service.serviceId,
          serviceNameSnapshot: service.serviceNameSnapshot,
          bookingCount: service.bookingCount,
          revenueCents: service.revenueCents,
          rank: service.rank,
        })),
      })
    }

    if (stats.products.length > 0) {
      await tx.professionalMonthlyProductAnalytics.createMany({
        data: stats.products.map((product) => ({
          analyticsId: analytics.id,
          productId: product.productId,
          productNameSnapshot: product.productNameSnapshot,
          quantity: product.quantity,
          revenueCents: product.revenueCents,
          rank: product.rank,
        })),
      })
    }
  })

  const saved = await readProfessionalMonthlyAnalytics({
    professionalId: args.professionalId,
    monthKey: args.monthKey,
  })

  if (!saved) {
    throw new Error('Professional monthly analytics recompute failed.')
  }

  return saved
}

export async function ensureProfessionalMonthlyAnalytics(args: {
  professionalId: string
  monthKey: string
  timeZone: string | null | undefined
}): Promise<ProfessionalMonthlyAnalyticsSnapshot> {
  const existing = await readProfessionalMonthlyAnalytics({
    professionalId: args.professionalId,
    monthKey: args.monthKey,
  })

  if (existing) return existing

  return recomputeProfessionalMonthlyAnalytics(args)
}

function buildOverviewStats(args: {
  current: ProfessionalMonthlyAnalyticsSnapshot
  previous: ProfessionalMonthlyAnalyticsSnapshot
}): Pick<
  ProOverviewPageData,
  'revenue' | 'primaryStats' | 'secondaryStats' | 'topServices'
> {
  const trend = revenueTrend({
    currentCents: args.current.revenueTotalCents,
    previousCents: args.previous.revenueTotalCents,
  })

  const averageBookingValueCents =
    args.current.completedBookingCount > 0
      ? Math.round(
          args.current.revenueTotalCents /
            args.current.completedBookingCount,
        )
      : 0

  const repeatRate = percentLabel(
    args.current.repeatClientCount,
    args.current.uniqueClientCount,
  )

  const retentionRate = percentLabel(
    args.current.futureRebookedClientCount,
    args.current.uniqueClientCount,
  )

  const primaryStats: ProOverviewMetricItem[] = [
    {
      label: 'BOOKINGS',
      value: String(args.current.completedBookingCount),
      sub: `${args.previous.completedBookingCount} last month`,
    },
    {
      label: 'AVG VALUE',
      value: centsToMoneyLabel(averageBookingValueCents),
      sub: 'per completed booking',
    },
    {
      label: 'NEW CLIENTS',
      value: String(args.current.newClientCount),
      sub: 'this month',
    },
    {
      label: 'REPEAT RATE',
      value: repeatRate,
      sub: 'returning clients',
    },
  ]

  const secondaryStats: ProOverviewMetricItem[] = [
    {
      label: 'TOTAL CLIENTS',
      value: String(args.current.uniqueClientCount),
      sub: 'seen this month',
    },
    {
      label: 'RETENTION',
      value: retentionRate,
      sub: `${args.current.futureRebookedClientCount} future rebooked`,
    },
    {
      label: 'TIPS',
      value: centsToMoneyLabel(args.current.tipCents),
      sub: 'collected this month',
    },
    {
      label: 'NO REBOOK',
      value: String(args.current.noFutureRebookClientCount),
      sub: 'no future booking yet',
    },
  ]

  const topServices: ProOverviewTopServiceItem[] = args.current.services.map(
    (service) => ({
      id: service.serviceId,
      name: service.serviceNameSnapshot,
      bookings: service.bookingCount,
      revenueLabel: centsToMoneyLabel(service.revenueCents),
    }),
  )

  return {
    revenue: {
      value: centsToMoneyLabel(args.current.revenueTotalCents),
      trendLabel: trend.label,
      trendTone: trend.tone,
      sub: `vs. ${centsToMoneyLabel(args.previous.revenueTotalCents)} last month`,
    },
    primaryStats,
    secondaryStats,
    topServices,
  }
}

export async function loadProOverviewPage(args: {
  professionalId: string
  professionalTimeZone: string | null | undefined
  searchParams: ProOverviewSearchParams | undefined
  now: Date
}): Promise<ProOverviewPageData> {
  const timeZone = sanitizeTimeZone(
    args.professionalTimeZone,
    DEFAULT_TIME_ZONE,
  )

  const fallbackMonth = currentYearMonthInTimeZone(args.now, timeZone)

  const activeMonth =
    parseMonthParam(args.searchParams?.month) ?? fallbackMonth

  const previousMonth = addMonths(activeMonth, -1)

  const activeMonthKey = monthKey(activeMonth)
  const previousMonthKey = monthKey(previousMonth)

  const [current, previous] = await Promise.all([
    ensureProfessionalMonthlyAnalytics({
      professionalId: args.professionalId,
      monthKey: activeMonthKey,
      timeZone,
    }),
    ensureProfessionalMonthlyAnalytics({
      professionalId: args.professionalId,
      monthKey: previousMonthKey,
      timeZone,
    }),
  ])

  const overviewStats = buildOverviewStats({
    current,
    previous,
  })

  return {
    activeMonth: {
      key: activeMonthKey,
      label: monthLabel(activeMonth, timeZone),
      timeZone,
    },
    months: buildMonthNav({
      activeMonth,
      timeZone,
    }),
    ...overviewStats,
  }
}