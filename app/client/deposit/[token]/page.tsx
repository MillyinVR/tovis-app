// app/client/deposit/[token]/page.tsx
//
// K10-B: the public (no-login) deposit pay page, reached from the EMAIL/SMS
// magic link. A pro-created client is often UNCLAIMED and cannot use the
// login-gated deposit surface, so this page renders the booking summary, the
// stamped release deadline, and a Pay CTA that mints the Stripe session via
// the token route.
//
// Unlike the aftercare page (which 404s on any token error), an exhausted link
// here still renders honest terminal states — "already paid", "booking
// cancelled" — because the client was TEXTED this URL and will reopen it after
// paying; a 404 would read as something having gone wrong with their money.

import { BookingDepositStatus, BookingStatus } from '@prisma/client'
import { notFound } from 'next/navigation'

import { isBookingError } from '@/lib/booking/errors'
import { resolveDepositPaymentTokenForRead } from '@/lib/booking/depositPaymentTokens'
import { formatMoneyFromUnknown } from '@/lib/money'
import { pickString } from '@/lib/pick'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import {
  formatInTimeZone,
  friendlyTimeZoneLabel,
  sanitizeTimeZone,
} from '@/lib/time'

import { PayDepositButton } from './PayDepositButton'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type SearchParamsInput = Record<string, string | string[] | undefined>

type PageProps = {
  params: { token: string } | Promise<{ token: string }>
  searchParams?: SearchParamsInput | Promise<SearchParamsInput | undefined>
}

function formatWhen(date: Date | null, timeZone: string): string | null {
  if (!date) return null

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

export default async function PublicDepositPaymentPage(props: PageProps) {
  const resolvedParams = await Promise.resolve(props.params)
  const routeToken = pickString(resolvedParams?.token)
  if (!routeToken) notFound()

  const resolvedSearchParams =
    (await Promise.resolve(props.searchParams).catch(() => undefined)) ?? {}
  const checkoutParam = pickString(resolvedSearchParams.checkout)

  let resolved: Awaited<ReturnType<typeof resolveDepositPaymentTokenForRead>>
  try {
    resolved = await resolveDepositPaymentTokenForRead({ rawToken: routeToken })
  } catch (error) {
    if (isBookingError(error)) {
      return (
        <main className="mx-auto w-full max-w-[640px] px-4 pb-20 pt-16 text-textPrimary">
          <StatusCard
            tone="danger"
            title="Payment link unavailable"
            body="That payment link is invalid or expired. Ask your professional to send a new one if a deposit is still due."
          />
        </main>
      )
    }
    throw error
  }

  const booking = resolved.booking

  const timeZone = sanitizeTimeZone(
    booking.locationTimeZone ?? booking.professional?.timeZone ?? 'UTC',
    'UTC',
  )
  const serviceTitle = booking.service?.name || 'Appointment'
  const professionalLabel = formatProfessionalPublicDisplayName(
    booking.professional,
    'your professional',
  )
  const amountLabel = formatMoneyFromUnknown(booking.depositAmount) ?? 'your'
  const scheduledLabel = formatWhen(booking.scheduledFor, timeZone)
  const payByLabel = formatWhen(booking.depositDueAt, timeZone)
  const tzLabel = friendlyTimeZoneLabel(timeZone) ?? timeZone

  const isCancelled = booking.status === BookingStatus.CANCELLED
  const isPaid =
    booking.depositStatus === BookingDepositStatus.PAID ||
    booking.depositPaidAt != null
  const isPending =
    booking.depositStatus === BookingDepositStatus.PENDING && !isPaid

  return (
    <main className="mx-auto w-full max-w-[640px] px-4 pb-20 pt-16 text-textPrimary">
      <header className="rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
        <span className="inline-flex items-center rounded-full border border-textPrimary/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
          Secure deposit link
        </span>

        <h1 className="mt-4 text-[24px] font-black text-textPrimary">
          {serviceTitle}
        </h1>

        <div className="mt-2 text-sm text-textSecondary">
          With {professionalLabel}
        </div>

        {scheduledLabel ? (
          <div className="mt-2 text-sm text-textSecondary">
            {scheduledLabel} <span className="opacity-70">· {tzLabel}</span>
          </div>
        ) : null}
      </header>

      <div className="mt-4 grid gap-4">
        {isCancelled ? (
          <StatusCard
            tone="danger"
            title="This booking was cancelled"
            body="There is nothing to pay. If you'd like to rebook, reach out to your professional."
          />
        ) : isPaid ? (
          <StatusCard
            tone="success"
            title="Deposit paid — you're all set"
            body={`Your ${amountLabel === 'your' ? '' : `${amountLabel} `}deposit is in and your appointment is secured. It counts toward your final total.`}
          />
        ) : isPending && checkoutParam === 'success' ? (
          <StatusCard
            tone="success"
            title="Payment received — finishing up"
            body="Thanks! Your payment is processing and your appointment will show as secured shortly. You can close this page."
          />
        ) : isPending ? (
          <section className="rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
            <div className="text-sm font-black text-textPrimary">
              {amountLabel === 'your'
                ? 'A deposit is due to secure this appointment'
                : `A ${amountLabel} deposit is due to secure this appointment`}
            </div>

            <div className="mt-2 text-sm text-textSecondary">
              It counts toward your final total — nothing is charged twice.
            </div>

            {payByLabel ? (
              <div className="mt-3 rounded-card border border-toneWarn/30 bg-toneWarn/10 px-4 py-3 text-sm text-textPrimary">
                Pay by <span className="font-black">{payByLabel}</span>{' '}
                <span className="opacity-70">({tzLabel})</span> — the booking is
                released automatically if the deposit stays unpaid.
              </div>
            ) : null}

            {checkoutParam === 'cancelled' ? (
              <div className="mt-3 text-sm text-textSecondary">
                Your last checkout was cancelled before paying — no charge was
                made. You can try again below.
              </div>
            ) : null}

            <div className="mt-4">
              <PayDepositButton
                token={routeToken}
                amountLabel={amountLabel === 'your' ? 'your' : amountLabel}
              />
            </div>
          </section>
        ) : (
          <StatusCard
            title="No deposit is due"
            body="This booking has no outstanding deposit. If something looks off, check with your professional."
          />
        )}

        <section className="text-xs text-textSecondary/75">
          <div className="font-black text-textSecondary">Need help?</div>
          <div className="mt-1">
            If this link no longer works, ask {professionalLabel} for a new
            payment link.
          </div>
        </section>
      </div>
    </main>
  )
}
