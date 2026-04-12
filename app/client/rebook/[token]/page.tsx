// app/client/rebook/[token]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BookingSource, BookingStatus } from '@prisma/client'
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
  | { mode: 'BOOKED_NEXT_APPOINTMENT'; label: string; bookedAt: Date }
  | {
      mode: 'RECOMMENDED_WINDOW'
      label: string
      windowStart: Date
      windowEnd: Date
    }
  | { mode: 'RECOMMENDED_DATE'; label: string; recommendedAt: Date }
  | { mode: 'NONE'; label: null }

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function pickSearchParam(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return pickString(v[0] ?? null)
  return pickString(v ?? null)
}

function formatMoneyFromUnknown(v: unknown): string | null {
  if (v == null) return null

  if (typeof v === 'number' && Number.isFinite(v)) {
    return `$${v.toFixed(2)}`
  }

  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    const n = Number(s)
    if (Number.isFinite(n)) return `$${n.toFixed(2)}`
    return s.startsWith('$') ? s : `$${s}`
  }

  if (typeof v === 'object' && v !== null) {
    const maybeToString = v.toString
    if (typeof maybeToString === 'function') {
      const result = maybeToString.call(v)
      if (typeof result === 'string') return formatMoneyFromUnknown(result)
    }
  }

  return null
}

function computeRebookInfo(
  aftercare: {
    rebookMode: string
    rebookedFor: Date | null
    rebookWindowStart: Date | null
    rebookWindowEnd: Date | null
  },
  timeZone: string,
): RebookInfo {
  const mode = String(aftercare.rebookMode || '').toUpperCase()

  if (mode === 'BOOKED_NEXT_APPOINTMENT') {
    const d = toDate(aftercare.rebookedFor)
    if (!d) return { mode: 'NONE', label: null }

    return {
      mode: 'BOOKED_NEXT_APPOINTMENT',
      label: `Next appointment booked: ${formatAppointmentWhen(d, timeZone)}`,
      bookedAt: d,
    }
  }

  if (mode === 'RECOMMENDED_WINDOW') {
    const s = toDate(aftercare.rebookWindowStart)
    const e = toDate(aftercare.rebookWindowEnd)

    if (s && e) {
      return {
        mode: 'RECOMMENDED_WINDOW',
        label: `Recommended rebook window: ${formatRangeInTimeZone(
          s,
          e,
          timeZone,
        )}`,
        windowStart: s,
        windowEnd: e,
      }
    }

    return { mode: 'NONE', label: null }
  }

  const legacy = toDate(aftercare.rebookedFor)
  if (legacy) {
    return {
      mode: 'RECOMMENDED_DATE',
      label: `Recommended next visit: ${formatAppointmentWhen(
        legacy,
        timeZone,
      )}`,
      recommendedAt: legacy,
    }
  }

  return { mode: 'NONE', label: null }
}

function statusLabel(value: BookingStatus | string | null | undefined): string {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (s === 'PENDING') return 'Pending'
  if (s === 'ACCEPTED') return 'Accepted'
  if (s === 'COMPLETED') return 'Completed'
  if (s === 'CANCELLED') return 'Cancelled'
  return s || 'Unknown'
}

function SectionCard(props: {
  title: string
  subtitle?: string | null
  children: React.ReactNode
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

export default async function ClientRebookFromAftercarePage(props: PageProps) {
  const resolvedParams = await Promise.resolve(props.params)
  const publicToken = pickString(resolvedParams?.token)
  if (!publicToken) notFound()

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
      rawToken: publicToken,
    })
  } catch (error) {
    if (isBookingError(error)) notFound()
    throw error
  }

  const booking = resolved.booking
  const aftercare = resolved.aftercare

  const appointmentTz = sanitizeTimeZone(
    booking.professional?.timeZone ?? 'UTC',
    'UTC',
  )

  const serviceTitle = booking.service?.name || 'Service'
  const proLabel =
    booking.professional?.businessName || 'your professional'
  const proId = booking.professional?.id || booking.professionalId
  const notes = typeof aftercare.notes === 'string' ? aftercare.notes : null
  const locationLabel =
    booking.professional?.location?.trim() || null

  const rebookInfo = computeRebookInfo(
    {
      rebookMode: aftercare.rebookMode,
      rebookedFor: aftercare.rebookedFor,
      rebookWindowStart: aftercare.rebookWindowStart,
      rebookWindowEnd: aftercare.rebookWindowEnd,
    },
    appointmentTz,
  )

  let offeringId = pickString(booking.offeringId)
  if (!offeringId && booking.serviceId) {
    const fallbackOffering = await prisma.professionalServiceOffering.findFirst({
      where: {
        professionalId: booking.professionalId,
        serviceId: booking.serviceId,
        isActive: true,
      },
      select: { id: true },
    })

    offeringId = fallbackOffering?.id ?? null
  }

  let nextBooking: {
    id: string
    scheduledFor: Date
    status: BookingStatus
  } | null = null

  try {
    nextBooking = await prisma.booking.findFirst({
      where: {
        rebookOfBookingId: booking.id,
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
    nextBooking = null
  }

  const baseParams = new URLSearchParams({
    source: 'AFTERCARE',
    token: publicToken,
    rebookOfBookingId: booking.id,
  })

  const bookParams = new URLSearchParams(baseParams)

  if (recommendedAtFromUrl) bookParams.set('recommendedAt', recommendedAtFromUrl)
  if (windowStartFromUrl) bookParams.set('windowStart', windowStartFromUrl)
  if (windowEndFromUrl) bookParams.set('windowEnd', windowEndFromUrl)

  if (!recommendedAtFromUrl && !windowStartFromUrl && !windowEndFromUrl) {
    if (rebookInfo.mode === 'RECOMMENDED_DATE') {
      bookParams.set('recommendedAt', rebookInfo.recommendedAt.toISOString())
    } else if (rebookInfo.mode === 'RECOMMENDED_WINDOW') {
      bookParams.set('windowStart', rebookInfo.windowStart.toISOString())
      bookParams.set('windowEnd', rebookInfo.windowEnd.toISOString())
    }
  }

  const bookHref = offeringId
    ? `/offerings/${encodeURIComponent(offeringId)}?${bookParams.toString()}`
    : null

  const sourceAppointmentLabel = formatAppointmentWhen(
    booking.scheduledFor,
    appointmentTz,
  )

  const nextBookingLabel = nextBooking
    ? formatAppointmentWhen(nextBooking.scheduledFor, appointmentTz)
    : null

  const subtotalLabel =
    formatMoneyFromUnknown(booking.subtotalSnapshot) || null

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-14 pt-16 text-textPrimary">
      <header className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-5">
        <div className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
          Secure aftercare link
        </div>

        <h1 className="mt-4 text-lg font-black">Aftercare for {serviceTitle}</h1>

        <div className="mt-2 text-sm text-textSecondary">
          With{' '}
          {proId ? (
            <Link
              href={`/professionals/${encodeURIComponent(proId)}`}
              className="font-black hover:underline underline-offset-4"
            >
              {proLabel}
            </Link>
          ) : (
            <span className="font-black">{proLabel}</span>
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
          <span className="opacity-70"> · {appointmentTz}</span>
        </div>

        <div className="mt-2 text-xs text-textSecondary/80">
          No account required to view aftercare and rebook from this link.
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
              <span className="opacity-70">· {appointmentTz}</span>
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
                  rebookInfo.mode === 'NONE' && 'opacity-70',
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
              Access source:{' '}
              <span className="font-black text-textPrimary">
                {resolved.accessSource === 'clientActionToken'
                  ? 'Client action token'
                  : 'Legacy public token'}
              </span>
            </div>

            {resolved.token?.expiresAt ? (
              <div>
                Token expires:{' '}
                <span className="font-black text-textPrimary">
                  {resolved.token.expiresAt.toLocaleString()}
                </span>
              </div>
            ) : null}

            <div className="break-all">
              /client/rebook/{publicToken}
            </div>
          </div>
        </SectionCard>
      </div>
    </main>
  )
}