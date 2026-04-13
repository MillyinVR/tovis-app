import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AftercareRebookMode,
  BookingSource,
  BookingStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'
import {
  formatAppointmentWhen,
  formatRangeInTimeZone,
} from '@/lib/formatInTimeZone'
import { pickString } from '@/lib/pick'
import { cn } from '@/lib/utils'
import { resolveAftercareAccessByToken } from '@/lib/aftercare/unclaimedAftercareAccess'
import { isBookingError } from '@/lib/booking/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type SearchParamsInput = Record<string, string | string[] | undefined>

type PageProps = {
  params: { token: string } | Promise<{ token: string }>
  searchParams?: SearchParamsInput | Promise<SearchParamsInput | undefined>
}

type RebookInfo =
  | {
      mode: 'BOOKED_NEXT_APPOINTMENT'
      label: string
      bookedAt: Date
    }
  | {
      mode: 'RECOMMENDED_WINDOW'
      label: string
      windowStart: Date
      windowEnd: Date
    }
  | {
      mode: 'NONE'
      label: null
    }

function toDate(value: unknown): Date | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function pickSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return pickString(value[0] ?? null)
  return pickString(value ?? null)
}

function formatMoneyFromUnknown(value: unknown): string | null {
  if (value == null) return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `$${value.toFixed(2)}`
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) {
      return `$${parsed.toFixed(2)}`
    }

    return trimmed.startsWith('$') ? trimmed : `$${trimmed}`
  }

  if (typeof value === 'object' && value !== null) {
    const maybeToString = value.toString
    if (typeof maybeToString === 'function') {
      const rendered = maybeToString.call(value)
      if (typeof rendered === 'string') {
        return formatMoneyFromUnknown(rendered)
      }
    }
  }

  return null
}

function computeRebookInfo(
  aftercare: {
    rebookMode: AftercareRebookMode
    rebookedFor: Date | null
    rebookWindowStart: Date | null
    rebookWindowEnd: Date | null
  },
  timeZone: string,
): RebookInfo {
  if (aftercare.rebookMode === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT) {
    const bookedAt = toDate(aftercare.rebookedFor)
    if (!bookedAt) {
      return {
        mode: 'NONE',
        label: null,
      }
    }

    return {
      mode: 'BOOKED_NEXT_APPOINTMENT',
      label: `Next appointment booked: ${formatAppointmentWhen(bookedAt, timeZone)}`,
      bookedAt,
    }
  }

  if (aftercare.rebookMode === AftercareRebookMode.RECOMMENDED_WINDOW) {
    const windowStart = toDate(aftercare.rebookWindowStart)
    const windowEnd = toDate(aftercare.rebookWindowEnd)

    if (!windowStart || !windowEnd) {
      return {
        mode: 'NONE',
        label: null,
      }
    }

    return {
      mode: 'RECOMMENDED_WINDOW',
      label: `Recommended rebook window: ${formatRangeInTimeZone(
        windowStart,
        windowEnd,
        timeZone,
      )}`,
      windowStart,
      windowEnd,
    }
  }

  return {
    mode: 'NONE',
    label: null,
  }
}

function statusLabel(value: BookingStatus | string | null | undefined): string {
  const normalized =
    typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (normalized === 'PENDING') return 'Pending'
  if (normalized === 'ACCEPTED') return 'Accepted'
  if (normalized === 'COMPLETED') return 'Completed'
  if (normalized === 'CANCELLED') return 'Cancelled'
  return normalized || 'Unknown'
}

function SectionCard(props: {
  title: string
  subtitle?: string | null
  children: ReactNode
}) {
  return (
    <section className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
      <div className="text-xs font-black">{props.title}</div>
      {props.subtitle ? (
        <div className="mt-1 text-sm text-textSecondary">{props.subtitle}</div>
      ) : null}
      <div className="mt-3">{props.children}</div>
    </section>
  )
}

function buildBaseBookParams(args: {
  routeToken: string
  bookingId: string
}): URLSearchParams {
  return new URLSearchParams({
    source: 'AFTERCARE',
    token: args.routeToken,
    rebookOfBookingId: args.bookingId,
  })
}

function applyRebookRecommendationParams(args: {
  params: URLSearchParams
  rebookInfo: RebookInfo
  recommendedAtFromUrl: string | null
  windowStartFromUrl: string | null
  windowEndFromUrl: string | null
}): URLSearchParams {
  const {
    params,
    rebookInfo,
    recommendedAtFromUrl,
    windowStartFromUrl,
    windowEndFromUrl,
  } = args

  if (recommendedAtFromUrl) {
    params.set('recommendedAt', recommendedAtFromUrl)
  }

  if (windowStartFromUrl) {
    params.set('windowStart', windowStartFromUrl)
  }

  if (windowEndFromUrl) {
    params.set('windowEnd', windowEndFromUrl)
  }

  const hasExplicitUrlOverrides =
    Boolean(recommendedAtFromUrl) ||
    Boolean(windowStartFromUrl) ||
    Boolean(windowEndFromUrl)

  if (hasExplicitUrlOverrides) {
    return params
  }

  if (rebookInfo.mode === 'RECOMMENDED_WINDOW') {
    params.set('windowStart', rebookInfo.windowStart.toISOString())
    params.set('windowEnd', rebookInfo.windowEnd.toISOString())
  }

  return params
}

async function getActiveOfferingId(args: {
  professionalId: string
  serviceId: string | null
  offeringId: string | null
}): Promise<string | null> {
  const explicitOfferingId = pickString(args.offeringId)
  if (explicitOfferingId) {
    return explicitOfferingId
  }

  if (!args.serviceId) {
    return null
  }

  const fallbackOffering = await prisma.professionalServiceOffering.findFirst({
    where: {
      professionalId: args.professionalId,
      serviceId: args.serviceId,
      isActive: true,
    },
    select: { id: true },
  })

  return fallbackOffering?.id ?? null
}

async function getNextAftercareBooking(args: {
  bookingId: string
}): Promise<{
  id: string
  scheduledFor: Date
  status: BookingStatus
} | null> {
  try {
    return await prisma.booking.findFirst({
      where: {
        rebookOfBookingId: args.bookingId,
        source: BookingSource.AFTERCARE,
        status: { not: BookingStatus.CANCELLED },
      },
      orderBy: { scheduledFor: 'asc' },
      select: {
        id: true,
        scheduledFor: true,
        status: true,
      },
    })
  } catch {
    return null
  }
}

export default async function ClientRebookFromAftercarePage(props: PageProps) {
  const resolvedParams = await Promise.resolve(props.params)
  const routeToken = pickString(resolvedParams?.token)
  if (!routeToken) notFound()

  const resolvedSearchParams =
    (await Promise.resolve(props.searchParams).catch(() => undefined)) ?? {}

  const recommendedAtFromUrl = pickSearchParam(
    resolvedSearchParams.recommendedAt,
  )
  const windowStartFromUrl = pickSearchParam(resolvedSearchParams.windowStart)
  const windowEndFromUrl = pickSearchParam(resolvedSearchParams.windowEnd)

  let resolved: Awaited<ReturnType<typeof resolveAftercareAccessByToken>>
  try {
    resolved = await resolveAftercareAccessByToken({
      rawToken: routeToken,
    })
  } catch (error) {
    if (isBookingError(error)) notFound()
    throw error
  }

  const booking = resolved.booking
  const aftercare = resolved.aftercare
  const accessToken = resolved.token

  const appointmentTimeZone = sanitizeTimeZone(
    booking.professional?.timeZone ?? 'UTC',
    'UTC',
  )

  const serviceTitle = booking.service?.name || 'Service'
  const professionalLabel =
    booking.professional?.businessName || 'your professional'
  const professionalId = booking.professional?.id || booking.professionalId
  const notes = typeof aftercare.notes === 'string' ? aftercare.notes : null
  const locationLabel = booking.professional?.location?.trim() || null

  const rebookInfo = computeRebookInfo(
    {
      rebookMode: aftercare.rebookMode,
      rebookedFor: aftercare.rebookedFor,
      rebookWindowStart: aftercare.rebookWindowStart,
      rebookWindowEnd: aftercare.rebookWindowEnd,
    },
    appointmentTimeZone,
  )

  const offeringId = await getActiveOfferingId({
    professionalId: booking.professionalId,
    serviceId: booking.serviceId,
    offeringId: booking.offeringId,
  })

  const nextBooking = await getNextAftercareBooking({
    bookingId: booking.id,
  })

  const bookParams = applyRebookRecommendationParams({
    params: buildBaseBookParams({
      routeToken,
      bookingId: booking.id,
    }),
    rebookInfo,
    recommendedAtFromUrl,
    windowStartFromUrl,
    windowEndFromUrl,
  })

  const bookHref = offeringId
    ? `/offerings/${encodeURIComponent(offeringId)}?${bookParams.toString()}`
    : null

  const sourceAppointmentLabel = formatAppointmentWhen(
    booking.scheduledFor,
    appointmentTimeZone,
  )

  const nextBookingLabel = nextBooking
    ? formatAppointmentWhen(nextBooking.scheduledFor, appointmentTimeZone)
    : null

  const subtotalLabel = formatMoneyFromUnknown(booking.subtotalSnapshot)

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-14 pt-16 text-textPrimary">
      <header className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-5">
        <div className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
          Secure aftercare link
        </div>

        <h1 className="mt-4 text-lg font-black">Aftercare for {serviceTitle}</h1>

        <div className="mt-2 text-sm text-textSecondary">
          With{' '}
          {professionalId ? (
            <Link
              href={`/professionals/${encodeURIComponent(professionalId)}`}
              className="font-black hover:underline underline-offset-4"
            >
              {professionalLabel}
            </Link>
          ) : (
            <span className="font-black">{professionalLabel}</span>
          )}
          {locationLabel ? (
            <span className="opacity-80"> · {locationLabel}</span>
          ) : null}
        </div>

        <div className="mt-2 text-xs text-textSecondary/80">
          Original appointment:{' '}
          <span className="font-black text-textPrimary">
            {sourceAppointmentLabel}
          </span>
          <span className="opacity-70"> · {appointmentTimeZone}</span>
        </div>

        <div className="mt-2 text-xs text-textSecondary/80">
          No account required to view aftercare and rebook from this secure link.
        </div>
      </header>

      <div className="mt-4 grid gap-3">
        <SectionCard title="Aftercare notes">
          {notes ? (
            <div className="whitespace-pre-wrap text-sm text-textSecondary">
              {notes}
            </div>
          ) : (
            <div className="text-sm text-textSecondary/75">
              No aftercare notes provided.
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Appointment details"
          subtitle="Reference info from the completed service"
        >
          <div className="grid gap-2 text-sm text-textSecondary">
            <div>
              Status:{' '}
              <span className="font-black text-textPrimary">
                {statusLabel(booking.status)}
              </span>
            </div>

            <div>
              Duration:{' '}
              <span className="font-black text-textPrimary">
                {booking.totalDurationMinutes} min
              </span>
            </div>

            {subtotalLabel ? (
              <div>
                Total:{' '}
                <span className="font-black text-textPrimary">
                  {subtotalLabel}
                </span>
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Rebook">
          {rebookInfo.label ? (
            <div className="text-sm text-textSecondary">
              {rebookInfo.label}{' '}
              <span className="opacity-70">· {appointmentTimeZone}</span>
            </div>
          ) : (
            <div className="text-sm text-textSecondary/75">
              No rebook recommendation yet.
            </div>
          )}

          {nextBooking ? (
            <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary p-4">
              <div className="text-sm font-black text-textPrimary">
                Your next appointment is already booked
              </div>

              <div className="mt-1 text-sm text-textSecondary">
                {nextBookingLabel ? `${nextBookingLabel} · ` : null}
                {statusLabel(nextBooking.status)}
              </div>

              <div className="mt-3 text-xs text-textSecondary/75">
                This secure page avoids account-only booking screens. If you need
                changes, contact your professional directly or claim your account
                later to see the full booking backlog.
              </div>
            </div>
          ) : bookHref ? (
            <div className="mt-4">
              <Link
                href={bookHref}
                className={cn(
                  'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-black text-bgPrimary transition',
                  'bg-accentPrimary hover:bg-accentPrimaryHover',
                  rebookInfo.mode === AftercareRebookMode.NONE && 'opacity-70',
                )}
              >
                Book your next appointment
              </Link>

              <div className="mt-3 text-xs text-textSecondary/75">
                If you don’t see times you want, your pro may need to open more
                availability.
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary p-4">
              <div className="text-sm font-black text-textPrimary">
                Rebooking is not available right now
              </div>

              <div className="mt-1 text-sm text-textSecondary">
                We could not find an active offering for this service. Contact
                your professional to reopen booking access.
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Secure link details">
          <div className="grid gap-2 text-xs text-textSecondary/75">
            <div>
              Access type:{' '}
              <span className="font-black text-textPrimary">
                Client action token
              </span>
            </div>

            <div>
              Token expires:{' '}
              <span className="font-black text-textPrimary">
                {accessToken.expiresAt.toLocaleString()}
              </span>
            </div>

            <div>
              Single use:{' '}
              <span className="font-black text-textPrimary">
                {accessToken.singleUse ? 'Yes' : 'No'}
              </span>
            </div>

            <div>
              Access count:{' '}
              <span className="font-black text-textPrimary">
                {accessToken.useCount}
              </span>
            </div>

            <div className="break-all">/client/rebook/{routeToken}</div>
          </div>
        </SectionCard>
      </div>
    </main>
  )
}