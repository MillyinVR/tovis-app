// app/client/rebook/[token]/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { formatAppointmentWhen, formatRangeInTimeZone } from '@/lib/formatInTimeZone'
import { buildClientBookingDTO, type ClientBookingDTO } from '@/lib/dto/clientBooking'

export const dynamic = 'force-dynamic'

type SearchParamsShape = {
  recommendedAt?: string
  windowStart?: string
  windowEnd?: string
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function formatWhen(d: Date, timeZone: string) {
  return formatAppointmentWhen(d, timeZone)
}

function formatDateRange(start: Date, end: Date, timeZone: string) {
  return formatRangeInTimeZone(start, end, timeZone)
}

type RebookInfo =
  | { mode: 'BOOKED_NEXT_APPOINTMENT'; label: string; bookedAt: Date }
  | { mode: 'RECOMMENDED_WINDOW'; label: string; windowStart: Date; windowEnd: Date }
  | { mode: 'RECOMMENDED_DATE'; label: string; recommendedAt: Date }
  | { mode: 'NONE'; label: null }

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
      label: `Next appointment booked: ${formatWhen(d, timeZone)}`,
      bookedAt: d,
    }
  }

  if (mode === 'RECOMMENDED_WINDOW') {
    const s = toDate(aftercare.rebookWindowStart)
    const e = toDate(aftercare.rebookWindowEnd)
    if (s && e) {
      return {
        mode: 'RECOMMENDED_WINDOW',
        label: `Recommended rebook window: ${formatDateRange(s, e, timeZone)}`,
        windowStart: s,
        windowEnd: e,
      }
    }
    return { mode: 'NONE', label: null }
  }

  // Back-compat: single date set without mode
  const legacy = toDate(aftercare.rebookedFor)
  if (legacy) {
    return {
      mode: 'RECOMMENDED_DATE',
      label: `Recommended next visit: ${formatWhen(legacy, timeZone)}`,
      recommendedAt: legacy,
    }
  }

  return { mode: 'NONE', label: null }
}

function safeDecimalString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'object' && v && typeof (v as any).toString === 'function') return (v as any).toString()
  return null
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export default async function ClientRebookFromAftercarePage(props: {
  params: { token: string } | Promise<{ token: string }>
  searchParams?: SearchParamsShape | Promise<SearchParamsShape>
}) {
  const { token } = await Promise.resolve(props.params as any)
  const publicToken = pickString(token)
  if (!publicToken) notFound()

  const sp = props.searchParams ? await Promise.resolve(props.searchParams as any) : undefined
  const recommendedAtFromUrl = pickString(sp?.recommendedAt)
  const windowStartFromUrl = pickString(sp?.windowStart)
  const windowEndFromUrl = pickString(sp?.windowEnd)

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(`/client/rebook/${publicToken}`)}`)
  }

  const aftercare = await prisma.aftercareSummary.findUnique({
    where: { publicToken },
    select: {
      notes: true,
      rebookMode: true,
      rebookedFor: true,
      rebookWindowStart: true,
      rebookWindowEnd: true,
      booking: {
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          serviceId: true,
          offeringId: true,

          status: true,
          source: true,
          sessionStep: true,
          scheduledFor: true,
          finishedAt: true,

          subtotalSnapshot: true,
          totalDurationMinutes: true,
          bufferMinutes: true,

          locationType: true,
          locationId: true,
          locationTimeZone: true,
          locationAddressSnapshot: true,

          service: { select: { id: true, name: true } },

          professional: {
            select: {
              id: true,
              businessName: true,
              location: true,
              timeZone: true,
              user: { select: { email: true } },
            },
          },

          location: {
            select: {
              id: true,
              name: true,
              formattedAddress: true,
              city: true,
              state: true,
              timeZone: true,
            },
          },

          serviceItems: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            take: 80,
            select: {
              id: true,
              itemType: true,
              parentItemId: true,
              sortOrder: true,
              durationMinutesSnapshot: true,
              priceSnapshot: true,
              serviceId: true,
              service: { select: { name: true } },
            },
          },

          consultationNotes: true,
          consultationPrice: true,
          consultationConfirmedAt: true,
          consultationApproval: {
            select: {
              status: true,
              proposedServicesJson: true,
              proposedTotal: true,
              notes: true,
              approvedAt: true,
              rejectedAt: true,
            },
          },
        },
      },
    },
  })

  if (!aftercare?.booking) notFound()
  if (aftercare.booking.clientId !== user.clientProfile.id) notFound()

  const rawBooking = aftercare.booking

  let dto: ClientBookingDTO
  try {
    dto = await buildClientBookingDTO({
      booking: rawBooking as any,
      unreadAftercare: false,
      hasPendingConsultationApproval: false,
    })
  } catch {
    const fallbackTz = sanitizeTimeZone(rawBooking.locationTimeZone ?? rawBooking.professional?.timeZone, 'UTC')

    dto = {
      id: String(rawBooking.id),
      status: (rawBooking.status as any) ?? null,
      source: (rawBooking.source as any) ?? null,
      sessionStep: (rawBooking.sessionStep as any) ?? null,

      scheduledFor: (rawBooking.scheduledFor as any)?.toISOString?.() ?? new Date().toISOString(),
      totalDurationMinutes: Number(rawBooking.totalDurationMinutes ?? 0),
      bufferMinutes: Number(rawBooking.bufferMinutes ?? 0),

      subtotalSnapshot: safeDecimalString(rawBooking.subtotalSnapshot),

      locationType: (rawBooking.locationType as any) ?? null,
      locationId: rawBooking.locationId ? String(rawBooking.locationId) : null,

      timeZone: fallbackTz,
      timeZoneSource: 'FALLBACK',

      locationLabel: null,

      professional: rawBooking.professional
        ? {
            id: String(rawBooking.professional.id),
            businessName: rawBooking.professional.businessName ?? null,
            location: rawBooking.professional.location ?? null,
            timeZone: rawBooking.professional.timeZone ?? null,
          }
        : null,

      bookedLocation: rawBooking.location
        ? {
            id: String(rawBooking.location.id),
            name: rawBooking.location.name ?? null,
            formattedAddress: rawBooking.location.formattedAddress ?? null,
            city: rawBooking.location.city ?? null,
            state: rawBooking.location.state ?? null,
            timeZone: rawBooking.location.timeZone ?? null,
          }
        : null,

      display: {
        title: rawBooking.service?.name ?? 'Service',
        baseName: rawBooking.service?.name ?? 'Service',
        addOnNames: [],
        addOnCount: 0,
      },
      items: [],

      hasUnreadAftercare: false,
      hasPendingConsultationApproval: false,

      consultation: null,
    }
  }

  // offeringId fallback
  let offeringId = pickString(rawBooking.offeringId)
  if (!offeringId) {
    const fallbackOffering = await prisma.professionalServiceOffering.findFirst({
      where: {
        professionalId: rawBooking.professionalId,
        serviceId: rawBooking.serviceId,
        isActive: true,
      },
      select: { id: true },
    })
    offeringId = fallbackOffering?.id ?? null
  }
  if (!offeringId) notFound()

  const appointmentTz = sanitizeTimeZone(dto.timeZone, 'UTC')

  const proLabel = dto.professional?.businessName || rawBooking.professional?.user?.email || 'your professional'
  const serviceTitle = dto.display?.title || 'Service'
  const notes = typeof aftercare.notes === 'string' ? aftercare.notes : null

  const rebookInfo = computeRebookInfo(
    {
      rebookMode: aftercare.rebookMode,
      rebookedFor: aftercare.rebookedFor,
      rebookWindowStart: aftercare.rebookWindowStart,
      rebookWindowEnd: aftercare.rebookWindowEnd,
    },
    appointmentTz,
  )

  let nextBooking: { id: string; scheduledFor: Date; status: string } | null = null
  if (rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT') {
    try {
      nextBooking = await prisma.booking.findFirst({
        where: {
          rebookOfBookingId: rawBooking.id,
          source: 'AFTERCARE',
          status: { not: 'CANCELLED' },
        } as any,
        orderBy: { scheduledFor: 'asc' },
        select: { id: true, scheduledFor: true, status: true },
      })
    } catch {
      nextBooking = null
    }
  }

  const baseParams = new URLSearchParams({
    source: 'AFTERCARE',
    token: publicToken,
    rebookOfBookingId: rawBooking.id,
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

  const bookHref = `/offerings/${encodeURIComponent(offeringId)}?${bookParams.toString()}`
  const proId = dto.professional?.id || rawBooking.professionalId
  const locationLabel = dto.locationLabel || null

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-14 pt-16 text-textPrimary">
      <Link
        href={`/client/bookings/${encodeURIComponent(dto.id)}`}
        className={cx(
          'inline-flex items-center gap-2 rounded-full border border-surfaceGlass/10 bg-bgSecondary px-4 py-2',
          'text-xs font-black text-textPrimary transition hover:bg-surfaceGlass',
        )}
      >
        <span aria-hidden>←</span>
        <span>Back to booking</span>
      </Link>

      <header className="mt-4">
        <h1 className="text-lg font-black">Aftercare for {serviceTitle}</h1>

        <div className="mt-2 text-sm text-textSecondary">
          With{' '}
          {proId ? (
            <Link href={`/professionals/${encodeURIComponent(proId)}`} className="font-black hover:underline underline-offset-4">
              {proLabel}
            </Link>
          ) : (
            <span className="font-black">{proLabel}</span>
          )}
          {locationLabel ? <span className="opacity-80"> · {locationLabel}</span> : null}
        </div>

        <div className="mt-2 text-xs text-textSecondary/80">
          Times shown in <span className="font-black text-textPrimary">{appointmentTz}</span>
        </div>
      </header>

      <section className="mt-5 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
        <div className="text-xs font-black">Aftercare notes</div>
        {notes ? (
          <div className="mt-2 whitespace-pre-wrap text-sm text-textSecondary">{notes}</div>
        ) : (
          <div className="mt-2 text-sm text-textSecondary/75">No aftercare notes provided.</div>
        )}
      </section>

      <section className="mt-3 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
        <div className="text-xs font-black">Rebook</div>

        {rebookInfo.label ? (
          <div className="mt-2 text-sm text-textSecondary">
            {rebookInfo.label} <span className="opacity-70">· {appointmentTz}</span>
          </div>
        ) : (
          <div className="mt-2 text-sm text-textSecondary/75">No rebook recommendation yet.</div>
        )}

        <div className="mt-3">
          {nextBooking ? (
            <Link
              href={`/client/bookings/${encodeURIComponent(nextBooking.id)}`}
              className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
            >
              View your booked appointment
            </Link>
          ) : (
            <Link
              href={bookHref}
              className={cx(
                'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-black text-bgPrimary transition',
                'bg-accentPrimary hover:bg-accentPrimaryHover',
                rebookInfo.mode === 'NONE' && 'opacity-70',
              )}
            >
              Book your next appointment
            </Link>
          )}
        </div>

        <div className="mt-3 text-xs text-textSecondary/75">
          If you don’t see times you want, your pro may need to open more availability.
        </div>
      </section>

      <section className="mt-4 text-xs text-textSecondary/75">
        <div className="font-black text-textSecondary">Aftercare link</div>
        <div className="mt-1 break-all">/client/rebook/{publicToken}</div>
      </section>
    </main>
  )
}
