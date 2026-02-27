// app/pro/bookings/[id]/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import BookingActions from '../BookingActions'
import { moneyToString } from '@/lib/money'
import ClientNameLink from '@/app/_components/ClientNameLink'
import { getProClientVisibility } from '@/lib/clientVisibility'

import { pickTimeZoneOrNull, sanitizeTimeZone } from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'

export const dynamic = 'force-dynamic'

const FALLBACK_TZ = 'UTC'

function safeUpper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function statusTone(status: unknown) {
  const s = safeUpper(status)
  if (s === 'COMPLETED') return 'border-toneSuccess/30 text-toneSuccess'
  if (s === 'CANCELLED') return 'border-toneDanger/30 text-toneDanger'
  if (s === 'ACCEPTED') return 'border-accentPrimary/30 text-textPrimary'
  if (s === 'PENDING') return 'border-white/10 text-textPrimary'
  return 'border-white/10 text-textSecondary'
}

function StatusPill({ status }: { status: unknown }) {
  const s = safeUpper(status) || 'UNKNOWN'
  return (
    <span className={['inline-flex items-center rounded-full border bg-bgPrimary px-2 py-1 text-[11px] font-black', statusTone(s)].join(' ')}>
      {s}
    </span>
  )
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-[15px] font-black text-textPrimary">{title}</h2>
        {subtitle ? <div className="mt-1 text-[12px] font-semibold text-textSecondary">{subtitle}</div> : null}
      </div>
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">{children}</div>
    </section>
  )
}

/**
 * Schedule timezone for a pro (calendar owner):
 * Prefer primary bookable location tz, else any bookable, else pro.profile tz, else UTC.
 */
async function resolveProScheduleTimeZone(proId: string, proTimeZoneRaw: unknown): Promise<string> {
  const primary = await prisma.professionalLocation.findFirst({
    where: { professionalId: proId, isBookable: true, isPrimary: true },
    select: { timeZone: true },
  })

  const primaryTz = pickTimeZoneOrNull(primary?.timeZone)
  if (primaryTz) return primaryTz

  const any = await prisma.professionalLocation.findFirst({
    where: { professionalId: proId, isBookable: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { timeZone: true },
  })

  const anyTz = pickTimeZoneOrNull(any?.timeZone)
  if (anyTz) return anyTz

  const proTz = pickTimeZoneOrNull(proTimeZoneRaw)
  if (proTz) return proTz

  return FALLBACK_TZ
}

function resolveAppointmentTimeZone(bookingLocationTimeZone: unknown, scheduleTz: string) {
  const bookingTz = pickTimeZoneOrNull(bookingLocationTimeZone)
  if (bookingTz) return bookingTz
  return sanitizeTimeZone(scheduleTz, FALLBACK_TZ)
}

export default async function ProBookingDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/bookings')
  }

  const proId = user.professionalProfile.id

  const booking = await prisma.booking.findFirst({
    where: { id, professionalId: proId },
    include: {
      service: { include: { category: true } },
      client: { include: { user: true } },
      aftercareSummary: true,
    },
  })

  if (!booking) redirect('/pro/bookings')

  // ✅ client chart link depends on visibility policy (not “being on this page”)
  const visibility = await getProClientVisibility(proId, booking.clientId)
  const canLinkClient = visibility.canViewClient

  // ✅ schedule tz (calendar owner) + appointment tz (booking snapshot preferred)
  const scheduleTz = await resolveProScheduleTimeZone(proId, user.professionalProfile.timeZone)
  const apptTz = resolveAppointmentTimeZone((booking as any).locationTimeZone, scheduleTz)

  const total = moneyToString(booking.totalAmount ?? booking.subtotalSnapshot) ?? '0.00'
  const dur = Math.round(Number(booking.totalDurationMinutes ?? 0)) || 0

  const scheduledLabel = formatAppointmentWhen(booking.scheduledFor, apptTz)
  const startedLabel = booking.startedAt ? formatAppointmentWhen(booking.startedAt, apptTz) : '—'
  const finishedLabel = booking.finishedAt ? formatAppointmentWhen(booking.finishedAt, apptTz) : '—'

  // Only show tz badge if it differs from schedule tz (so we don’t spam)
  const showTzBadge = apptTz !== scheduleTz

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <a
          href="/pro/bookings"
          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
        >
          ← Back to bookings
        </a>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/pro/bookings/${encodeURIComponent(booking.id)}/session`}
            className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
          >
            Open session
          </a>

          <StatusPill status={booking.status} />

          <div className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2">
            <BookingActions
              bookingId={booking.id}
              currentStatus={booking.status}
              startedAt={booking.startedAt ? booking.startedAt.toISOString() : null}
              finishedAt={booking.finishedAt ? booking.finishedAt.toISOString() : null}
              timeZone={apptTz} // ✅ critical: keep actions timestamps consistent
            />
          </div>
        </div>
      </div>

      <header className="tovis-glass mb-6 rounded-card border border-white/10 bg-bgSecondary p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-black text-textPrimary">{booking.service?.name ?? 'Booking'}</h1>
              <StatusPill status={booking.status} />
            </div>

            <div className="mt-2 text-[12px] font-semibold text-textSecondary">
              Client:{' '}
              <ClientNameLink canLink={canLinkClient} clientId={booking.clientId}>
                {booking.client.firstName} {booking.client.lastName}
              </ClientNameLink>
              {booking.client.user?.email ? ` • ${booking.client.user.email}` : ''}
              {booking.client.phone ? ` • ${booking.client.phone}` : ''}
            </div>

            <div className="mt-2 text-[12px] font-semibold text-textSecondary">
              {scheduledLabel}
              {dur ? ` • ${dur} min` : ''}
              {showTzBadge ? <span className="text-textSecondary/70"> · {apptTz}</span> : null}
            </div>
          </div>

          <div className="shrink-0 md:text-right">
            <div className="text-[12px] font-semibold text-textSecondary">Total</div>
            <div className="text-[18px] font-black text-textPrimary">${total}</div>
            <div className="mt-1 text-[11px] font-semibold text-textSecondary/80">Booking ID: {booking.id}</div>
          </div>
        </div>
      </header>

      <div className="grid gap-6">
        <SectionCard title="Aftercare" subtitle="Snapshot saved on the booking (if provided).">
          {(booking as any).aftercareSummary?.notes ? (
            <div className="whitespace-pre-wrap text-[13px] font-semibold text-textSecondary">{(booking as any).aftercareSummary.notes}</div>
          ) : (
            <div className="rounded-card border border-white/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
              No aftercare notes yet.
            </div>
          )}
        </SectionCard>

        <SectionCard title="Timing" subtitle="State timestamps for this booking.">
          <div className="grid gap-2 text-[12px] font-semibold text-textSecondary">
            <div>
              Scheduled: <span className="font-black text-textPrimary">{scheduledLabel}</span>
            </div>
            <div>
              Started: <span className="font-black text-textPrimary">{startedLabel}</span>
            </div>
            <div>
              Finished: <span className="font-black text-textPrimary">{finishedLabel}</span>
            </div>
          </div>
        </SectionCard>
      </div>
    </main>
  )
}