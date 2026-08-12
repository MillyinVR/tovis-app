// app/client/appointment/[token]/page.tsx
//
// K12: the public (no-login) appointment action page reached from a reminder's
// EMAIL/SMS link — confirm (one tap), decline, cancel, reschedule. Anyone
// holding the message holds the token (the card's accepted premise), so
// confirm/decline are the only one-tap actions; cancel and reschedule sit
// behind explicit confirmation screens in the client card and their routes run
// the real policy paths (cancelRefund orchestration; the reschedule-hold
// commit path) — never shortcut writes.
//
// Like the K10-B deposit page (and unlike the aftercare page's 404), an
// exhausted or overtaken link renders honest terminal states — "cancelled",
// "already happened" — because the client was texted this URL.

import { BookingDepositStatus, BookingStatus } from '@prisma/client'
import { notFound } from 'next/navigation'

import {
  APPOINTMENT_CONFIRMATION_ANSWERABLE_STATUSES,
  resolveAppointmentConfirmationTokenForRead,
} from '@/lib/booking/appointmentConfirmationTokens'
import { isAutoCancelRefundEligible } from '@/lib/booking/cancelRefund'
import { deriveClientConfirmationBadge } from '@/lib/booking/clientConfirmation'
import { clientConfirmationLoopEnabled } from '@/lib/booking/clientConfirmationLoop'
import { isBookingError } from '@/lib/booking/errors'
import { formatMoneyFromUnknown } from '@/lib/money'
import { pickString } from '@/lib/pick'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import {
  formatInTimeZone,
  friendlyTimeZoneLabel,
  sanitizeTimeZone,
  ymdInTimeZone,
} from '@/lib/time'

import { AppointmentActionsCard } from './AppointmentActionsCard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type PageProps = {
  params: { token: string } | Promise<{ token: string }>
}

function formatWhen(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function StatusCard(props: {
  title: string
  body: string
  tone?: 'success' | 'danger' | 'neutral'
}) {
  const toneClass =
    props.tone === 'success'
      ? 'border-toneSuccess/20 bg-toneSuccess/5'
      : props.tone === 'danger'
        ? 'border-toneDanger/20 bg-toneDanger/5'
        : 'border-textPrimary/10 bg-bgSecondary'

  return (
    <div className={`rounded-card border p-5 ${toneClass}`}>
      <div className="text-sm font-black text-textPrimary">{props.title}</div>
      <div className="mt-2 text-sm text-textSecondary">{props.body}</div>
    </div>
  )
}

function UnavailableCard() {
  return (
    <main className="mx-auto w-full max-w-[640px] px-4 pb-20 pt-16 text-textPrimary">
      <StatusCard
        tone="danger"
        title="Appointment link unavailable"
        body="That appointment link is invalid or expired. You can still manage the appointment from your account, or reach out to your professional."
      />
    </main>
  )
}

export default async function PublicAppointmentActionPage(props: PageProps) {
  const resolvedParams = await Promise.resolve(props.params)
  const routeToken = pickString(resolvedParams?.token)
  if (!routeToken) notFound()

  if (!clientConfirmationLoopEnabled()) {
    return <UnavailableCard />
  }

  let resolved: Awaited<
    ReturnType<typeof resolveAppointmentConfirmationTokenForRead>
  >
  try {
    resolved = await resolveAppointmentConfirmationTokenForRead({
      rawToken: routeToken,
    })
  } catch (error) {
    if (isBookingError(error)) {
      return <UnavailableCard />
    }
    throw error
  }

  const booking = resolved.booking
  const now = new Date()

  const timeZone = sanitizeTimeZone(
    booking.locationTimeZone ?? booking.professional?.timeZone ?? 'UTC',
    'UTC',
  )
  const serviceTitle = booking.service?.name || 'Appointment'
  const professionalLabel = formatProfessionalPublicDisplayName(
    booking.professional,
    'your professional',
  )
  const whenLabel = formatWhen(booking.scheduledFor, timeZone)
  const tzLabel = friendlyTimeZoneLabel(timeZone) ?? timeZone

  const header = (
    <header className="rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
      <span className="inline-flex items-center rounded-full border border-textPrimary/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
        Your appointment
      </span>

      <h1 className="mt-4 text-[24px] font-black text-textPrimary">
        {serviceTitle}
      </h1>

      <div className="mt-2 text-sm text-textSecondary">
        With {professionalLabel}
      </div>

      <div className="mt-2 text-sm text-textSecondary">
        {whenLabel} <span className="opacity-70">· {tzLabel}</span>
      </div>
    </header>
  )

  const isCancelled = booking.status === BookingStatus.CANCELLED
  const hasHappened =
    booking.startedAt != null ||
    booking.finishedAt != null ||
    !APPOINTMENT_CONFIRMATION_ANSWERABLE_STATUSES.has(booking.status) ||
    booking.scheduledFor.getTime() <= now.getTime()

  if (isCancelled) {
    return (
      <main className="mx-auto w-full max-w-[640px] px-4 pb-20 pt-16 text-textPrimary">
        {header}
        <div className="mt-4">
          <StatusCard
            tone="danger"
            title="This booking was cancelled"
            body="There is nothing to confirm. If you'd like to rebook, reach out to your professional."
          />
        </div>
      </main>
    )
  }

  if (hasHappened) {
    return (
      <main className="mx-auto w-full max-w-[640px] px-4 pb-20 pt-16 text-textPrimary">
        {header}
        <div className="mt-4">
          <StatusCard
            title="This appointment can no longer be updated here"
            body="It has already started or passed. If something changed, reach out to your professional."
          />
        </div>
      </main>
    )
  }

  const badge = deriveClientConfirmationBadge(booking)
  const depositPaid = booking.depositStatus === BookingDepositStatus.PAID
  const depositAmountLabel = formatMoneyFromUnknown(booking.depositAmount)

  return (
    <main className="mx-auto w-full max-w-[640px] px-4 pb-20 pt-16 text-textPrimary">
      {header}

      <div className="mt-4">
        <AppointmentActionsCard
          token={routeToken}
          initialState={badge.kind}
          whenLabel={whenLabel}
          tzLabel={tzLabel}
          professionalLabel={professionalLabel}
          // The 24h line the cancel policy actually uses
          // (isAutoCancelRefundEligible is the commit site's own gate).
          fullRefundEligible={isAutoCancelRefundEligible({
            actorKind: 'client',
            scheduledFor: booking.scheduledFor,
            now,
          })}
          depositPaid={depositPaid}
          depositAmountLabel={depositPaid ? depositAmountLabel : null}
          reschedule={
            booking.service?.id && booking.locationId
              ? {
                  professionalId: booking.professionalId,
                  serviceId: booking.service.id,
                  locationType: booking.locationType,
                  locationId: booking.locationId,
                  clientAddressId: booking.clientAddressId,
                  timeZone,
                  appointmentYmd: ymdInTimeZone(booking.scheduledFor, timeZone),
                }
              : null
          }
        />
      </div>

      <section className="mt-4 text-xs text-textSecondary/75">
        <div className="font-black text-textSecondary">Need help?</div>
        <div className="mt-1">
          If this link no longer works, you can manage the appointment from
          your account, or reach out to {professionalLabel}.
        </div>
      </section>
    </main>
  )
}
