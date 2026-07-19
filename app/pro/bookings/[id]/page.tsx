// app/pro/bookings/[id]/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import BookingActions from '../BookingActions'
import MoneyTrailInspector from '@/app/_components/booking/MoneyTrailInspector'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { moneyToString } from '@/lib/money'
import {
  BookingCheckoutStatus,
  BookingSource,
  BookingStatus,
  PaymentProvider,
  Prisma,
  StripePaymentStatus,
} from '@prisma/client'
import { COPY } from '@/lib/copy'
import ConfirmPaymentReceivedButton from './ConfirmPaymentReceivedButton'
import ClientNameLink from '@/app/_components/ClientNameLink'
import { Avatar, Badge } from '@/app/_components/ui'
import {
  badgeToneForBookingStatus,
  labelForBookingStatus,
} from '@/lib/booking/statusLabel'
import { getProClientVisibility } from '@/lib/clientVisibility'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { resolveProScheduleTimeZone } from '@/lib/proLocations/resolveProScheduleTimeZone'
import { resolveAppointmentDisplayTimeZone } from '@/lib/booking/appointmentDisplayTimeZone'
import { pickString } from '@/lib/pick'
import { resolveBookingLocationMeta } from '@/lib/booking/locationMeta'
import { mapsHrefFromLocation } from '@/lib/maps'
import { paymentMethodLabel } from '@/lib/payments/acceptedMethods'

export const dynamic = 'force-dynamic'

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden
      className="fill-none stroke-current"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden
      className="fill-none stroke-current"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden
      className={['fill-none stroke-current', className].filter(Boolean).join(' ')}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

function PinIcon({
  className,
  size = 18,
}: {
  className?: string
  size?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={['fill-none stroke-current', className].filter(Boolean).join(' ')}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  )
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden
      className={['fill-none stroke-current', className].filter(Boolean).join(' ')}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden
      className={['fill-none stroke-current', className].filter(Boolean).join(' ')}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function CardIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden
      className={['fill-none stroke-current', className].filter(Boolean).join(' ')}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19" />
    </svg>
  )
}

function formatMoney(
  v: Prisma.Decimal | null | undefined,
): string | null {
  if (v == null) return null
  return moneyToString(v)
}

function MoneyRow({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span className={strong ? 'font-black text-textPrimary' : 'text-textMuted'}>
        {label}
      </span>
      <span className="font-display font-bold text-textPrimary">${value}</span>
    </div>
  )
}

export default async function ProBookingDetailPage(props: {
  params: Promise<{ id: string }>
}) {
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

  // Off-platform payment the client marked as sent (PF1) — the pro confirms
  // receipt here to close it out.
  const awaitingPaymentConfirmation =
    booking.checkoutStatus === BookingCheckoutStatus.AWAITING_CONFIRMATION

  // This booking is an aftercare next appointment coupled to a previous
  // appointment whose payment is still awaiting confirmation (PF2): it stays
  // PENDING until the pro confirms that payment, which approves this one. This
  // page is where the PAYMENT_CONFIRMATION_REQUIRED notification lands, so surface
  // the confirm action for the source booking.
  let coupledSourceBookingId: string | null = null
  if (
    booking.source === BookingSource.AFTERCARE &&
    booking.status === BookingStatus.PENDING &&
    booking.rebookOfBookingId
  ) {
    const sourceBooking = await prisma.booking.findFirst({
      where: { id: booking.rebookOfBookingId, professionalId: proId },
      select: { id: true, checkoutStatus: true },
    })
    if (
      sourceBooking?.checkoutStatus === BookingCheckoutStatus.AWAITING_CONFIRMATION
    ) {
      coupledSourceBookingId = sourceBooking.id
    }
  }

  const visibility = await getProClientVisibility(proId, booking.clientId)
  const canLinkClient = visibility.canViewClient

  const scheduleTz = await resolveProScheduleTimeZone(
    proId,
    user.professionalProfile.timeZone,
  )
  const apptTz = resolveAppointmentDisplayTimeZone(
    booking.locationTimeZone,
    scheduleTz,
  )

  const serviceName = booking.service?.name ?? 'Booking'
  const total =
    moneyToString(booking.totalAmount ?? booking.subtotalSnapshot) ?? '0.00'
  const dur = Math.round(Number(booking.totalDurationMinutes ?? 0)) || 0
  const shortId = booking.id.slice(-6).toUpperCase()

  const clientName = `${booking.client.firstName ?? ''} ${
    booking.client.lastName ?? ''
  }`.trim()
  const clientContact = [booking.client.user?.email, booking.client.phone]
    .filter(Boolean)
    .join(' · ')

  const scheduledLabel = formatAppointmentWhen(booking.scheduledFor, apptTz)
  const startedLabel = booking.startedAt
    ? formatAppointmentWhen(booking.startedAt, apptTz)
    : '—'
  const finishedLabel = booking.finishedAt
    ? formatAppointmentWhen(booking.finishedAt, apptTz)
    : '—'

  const showTzBadge = apptTz !== scheduleTz

  const timing = [
    { label: 'Scheduled', value: scheduledLabel, done: true },
    { label: 'Started', value: startedLabel, done: Boolean(booking.startedAt) },
    {
      label: 'Finished',
      value: finishedLabel,
      done: Boolean(booking.finishedAt),
    },
  ]

  // Tap-for-directions location (reuses the list's shared resolver). Snapshots
  // are already loaded via the `include` above — no extra query.
  const locationMeta = resolveBookingLocationMeta(booking)
  const mapsHref = locationMeta.formattedAddress
    ? mapsHrefFromLocation({
        formattedAddress: locationMeta.formattedAddress,
        lat: locationMeta.lat,
        lng: locationMeta.lng,
      })
    : null

  // Payment block — derived from already-loaded booking fields only.
  const isPaid =
    Boolean(booking.paymentCollectedAt) ||
    booking.stripePaymentStatus === StripePaymentStatus.SUCCEEDED
  const methodLabel = booking.selectedPaymentMethod
    ? paymentMethodLabel(booking.selectedPaymentMethod)
    : booking.paymentProvider === PaymentProvider.STRIPE
      ? 'Card'
      : null
  const collectedAt = booking.paymentCollectedAt ?? booking.stripePaidAt ?? null
  const collectedLabel = collectedAt
    ? formatAppointmentWhen(collectedAt, apptTz)
    : null
  const servicesAmount = formatMoney(
    booking.serviceSubtotalSnapshot ?? booking.subtotalSnapshot,
  )
  const tipStr = formatMoney(booking.tipAmount)
  const taxStr = formatMoney(booking.taxAmount)
  const discountStr = formatMoney(booking.discountAmount)

  // Aftercare snapshot (already loaded).
  const aftercare = booking.aftercareSummary
  const aftercareNotes = pickString(aftercare?.notes)
  const aftercareSent = Boolean(aftercare?.sentToClientAt)
  const aftercareDraft = !aftercareSent && Boolean(aftercare?.draftSavedAt)
  const aftercareVersion =
    typeof aftercare?.version === 'number' ? aftercare.version : null

  const sessionHref = `/pro/bookings/${encodeURIComponent(booking.id)}/session`
  const aftercareHref = `/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8 text-textPrimary">
      {/* back + status */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/pro/bookings"
          className="inline-flex items-center gap-1.5 text-textMuted transition hover:text-textSecondary"
        >
          <ChevronLeftIcon />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
            Bookings
          </span>
        </Link>

        <Badge tone={badgeToneForBookingStatus(booking.status)} size="sm">
          {labelForBookingStatus(booking.status)}
        </Badge>
      </div>

      {/* header card */}
      <section className="tovis-glass mb-3.5 rounded-card border border-white/10 bg-bgSecondary p-5">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accentPrimary">
          Booking · #{shortId}
        </div>

        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[24px] font-bold tracking-tight text-textPrimary">
              {serviceName}
            </h1>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-textMuted">
              Total
            </div>
            <div className="font-display text-[26px] font-bold leading-tight text-textPrimary">
              ${total}
            </div>
          </div>
        </div>

        {/* client */}
        <div className="mt-3.5 flex items-center gap-2.5 border-t border-white/10 pt-3.5">
          <Avatar name={clientName || undefined} size="md" aria-hidden />
          <div className="min-w-0">
            <div className="font-display text-[14px] font-bold text-textPrimary">
              <ClientNameLink canLink={canLinkClient} clientId={booking.clientId}>
                {clientName || 'Client'}
              </ClientNameLink>
            </div>
            {clientContact ? (
              <div className="truncate text-[11.5px] text-textMuted">
                {clientContact}
              </div>
            ) : null}
          </div>
        </div>

        {/* when */}
        <div className="mt-3 inline-flex flex-wrap items-center gap-1.5 text-[13px] text-textSecondary">
          <ClockIcon className="text-textMuted" />
          {scheduledLabel}
          {dur ? ` · ${dur} min` : ''}
          {showTzBadge ? (
            <span className="ml-1 font-mono text-[8px] font-bold uppercase tracking-widest text-textMuted">
              {apptTz}
            </span>
          ) : null}
        </div>

        {/* tap for directions */}
        {locationMeta.formattedAddress ? (
          mapsHref ? (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-bgPrimary px-3 py-2.5 transition hover:border-accentPrimary/40"
            >
              <PinIcon
                className={
                  locationMeta.isMobile ? 'text-accentPrimary' : 'text-textMuted'
                }
              />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-textMuted">
                  {locationMeta.isMobile ? 'Mobile' : 'Salon'} · tap for directions
                </div>
                <div className="mt-0.5 truncate text-[13px] text-textPrimary">
                  {locationMeta.formattedAddress}
                </div>
              </div>
              <ExternalIcon className="text-textMuted" />
            </a>
          ) : (
            <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-bgPrimary px-3 py-2.5">
              <PinIcon
                className={
                  locationMeta.isMobile ? 'text-accentPrimary' : 'text-textMuted'
                }
              />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-textMuted">
                  {locationMeta.isMobile ? 'Mobile' : 'Salon'}
                </div>
                <div className="mt-0.5 truncate text-[13px] text-textPrimary">
                  {locationMeta.formattedAddress}
                </div>
              </div>
            </div>
          )
        ) : null}

        {/* actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Link
            href={sessionHref}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-accentPrimary px-4 text-[14px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
          >
            Open session
            <ArrowRightIcon />
          </Link>
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <BookingActions
            bookingId={booking.id}
            status={booking.status}
            sessionStep={booking.sessionStep}
            startedAt={booking.startedAt ? booking.startedAt.toISOString() : null}
            finishedAt={
              booking.finishedAt ? booking.finishedAt.toISOString() : null
            }
            timeZone={apptTz}
            noShowFeatureEnabled={noShowProtectionEnabled()}
          />
        </div>
      </section>

      {/* coupled next appointment — pending until the previous payment is confirmed */}
      {coupledSourceBookingId ? (
        <section className="tovis-glass mb-3.5 rounded-card border border-accentPrimary/30 bg-accentPrimary/10 p-4">
          <h2 className="font-display text-[14px] font-bold text-textPrimary">
            {COPY.proBookingCheckout.coupledPendingTitle}
          </h2>
          <div className="mt-1 text-[12.5px] text-textSecondary">
            {COPY.proBookingCheckout.coupledPendingBody}
          </div>
          <div className="mt-3">
            <ConfirmPaymentReceivedButton bookingId={coupledSourceBookingId} />
          </div>
        </section>
      ) : null}

      {/* timing + payment */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <h2 className="font-display text-[14px] font-bold text-textPrimary">
            Timing
          </h2>
          <div className="mt-0.5 text-[12px] text-textMuted">
            State timestamps for this booking.
          </div>

          <div className="mt-3 flex flex-col">
            {timing.map((row) => (
              <div
                key={row.label}
                className="flex items-center gap-3 border-t border-white/10 py-2.5"
              >
                <span
                  className={[
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                    row.done
                      ? 'border-accentPrimary/30 bg-accentPrimary/10 text-accentPrimary'
                      : 'border-white/10 bg-bgPrimary text-textMuted',
                  ].join(' ')}
                >
                  {row.done ? (
                    <CheckIcon />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </span>
                <span className="flex-1 text-[13px] text-textSecondary">
                  {row.label}
                </span>
                <span className="font-display text-[13px] font-bold text-textPrimary">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <h2 className="font-display text-[14px] font-bold text-textPrimary">
            Payment
          </h2>
          <div className="mt-0.5 text-[12px] text-textMuted">
            {isPaid
              ? 'Collected and reconciled.'
              : awaitingPaymentConfirmation
                ? COPY.proBookingCheckout.awaitingConfirmationBody
                : 'Not collected yet.'}
          </div>

          <div
            className={[
              'mt-3 flex items-center gap-2.5 rounded-xl border px-3 py-2.5',
              isPaid
                ? 'border-accentPrimary/30 bg-accentPrimary/10'
                : 'border-toneWarn/30 bg-toneWarn/10',
            ].join(' ')}
          >
            <CardIcon
              className={isPaid ? 'text-accentPrimary' : 'text-toneWarn'}
            />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[13px] font-bold text-textPrimary">
                {isPaid
                  ? `Paid${methodLabel ? ` · ${methodLabel}` : ''}`
                  : 'Awaiting payment'}
              </div>
              <div className="text-[11.5px] text-textMuted">
                {isPaid
                  ? `$${total}${collectedLabel ? ` captured ${collectedLabel}` : ''}`
                  : `$${total} due`}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            {servicesAmount ? (
              <MoneyRow label="Services" value={servicesAmount} />
            ) : null}
            {discountStr ? (
              <MoneyRow label="Discount" value={`-${discountStr}`} />
            ) : null}
            {taxStr ? <MoneyRow label="Tax" value={taxStr} /> : null}
            {tipStr ? <MoneyRow label="Tip" value={tipStr} /> : null}
            <div className="mt-1 border-t border-dashed border-white/10 pt-2">
              <MoneyRow label="Total" value={total} strong />
            </div>
          </div>

          {awaitingPaymentConfirmation ? (
            <div className="mt-3 border-t border-white/10 pt-3">
              <ConfirmPaymentReceivedButton bookingId={booking.id} fullWidth />
              <p className="mt-2 text-[11.5px] text-textMuted">
                {COPY.proBookingCheckout.approvesNextNote}
              </p>
            </div>
          ) : null}
        </section>
      </div>

      {/* money trail — charges, fees, refunds + refund/waive actions */}
      <div className="mt-3.5">
        <MoneyTrailInspector bookingId={booking.id} />
      </div>

      {/* aftercare snapshot */}
      <section className="tovis-glass mt-3.5 rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[14px] font-bold text-textPrimary">
              Aftercare
            </h2>
            <div className="mt-0.5 text-[12px] text-textMuted">
              {aftercareSent
                ? `Sent to client${aftercareVersion ? ` · v${aftercareVersion}` : ''}`
                : aftercareDraft
                  ? 'Draft saved'
                  : 'Snapshot saved on the booking (if provided).'}
            </div>
          </div>

          {aftercareSent ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accentPrimary/30 bg-accentPrimary/10 px-3 py-1.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-accentPrimary">
              <CheckIcon />
              Sent
            </span>
          ) : aftercareDraft ? (
            <span className="inline-flex items-center rounded-full border border-toneWarn/30 bg-toneWarn/10 px-3 py-1.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-toneWarn">
              Draft
            </span>
          ) : null}
        </div>

        {aftercareNotes ? (
          <div className="mt-3 whitespace-pre-wrap rounded-xl border border-white/10 bg-bgPrimary p-3 text-[13px] leading-relaxed text-textSecondary">
            {aftercareNotes}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-white/10 bg-bgPrimary p-3 text-[12px] text-textMuted">
            No aftercare notes yet.
          </div>
        )}

        <Link
          href={aftercareHref}
          className="mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-bgPrimary px-4 text-[13px] font-black text-textPrimary transition hover:border-white/20"
        >
          View full aftercare
          <ArrowRightIcon />
        </Link>
      </section>
    </main>
  )
}
