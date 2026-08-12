// app/client/consent/[token]/page.tsx
//
// K15: the public (no-login) consent-signing page reached from the link a pro
// sends — read the document, type your name, agree.
//
// Unauthenticated for the K10-B reason: the client this is aimed at is often
// UNCLAIMED (ClientProfile.userId null) and can never pass requireClient(). And
// like the K12 appointment page, an already-signed or expired link renders an
// honest terminal state rather than a 404 — the client was TEXTED this URL, and
// "not found" for a link you were sent reads as the platform losing your
// signature.
//
// 🔴 The text shown is the version PINNED ON THE TOKEN, not the form's current
// version. If the pro published new words while this message sat unread, this
// page still shows — and the record still attests to — what was sent.

import { BookingStatus } from '@prisma/client'
import { notFound } from 'next/navigation'

import { isBookingError } from '@/lib/booking/errors'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { CONSENT_KIND_LABELS } from '@/lib/consentForms/kindLabels'
import { resolveConsentSignatureTokenForRead } from '@/lib/consentForms/signatureTokens'
import { pickString } from '@/lib/pick'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import {
  formatInTimeZone,
  friendlyTimeZoneLabel,
  sanitizeTimeZone,
} from '@/lib/time'

import { ConsentSignCard } from './ConsentSignCard'

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
    <main className="mx-auto w-full max-w-[720px] px-4 pb-20 pt-16 text-textPrimary">
      <StatusCard
        tone="danger"
        title="Consent link unavailable"
        body="That consent link is invalid or expired. Ask your professional to send you a new one."
      />
    </main>
  )
}

/**
 * The document itself. Plain text, `whitespace-pre-wrap` — K14 stores `body` as
 * plain text on purpose (nothing in this repo renders markdown, and an
 * HTML-rendering path over pro-authored legal text is an XSS surface).
 */
function DocumentCard(props: {
  title: string
  version: number
  kindLabel: string
  body: string
}) {
  return (
    <section className="mt-4 rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-black text-textPrimary">
          {props.title}
        </h2>
        <span className="text-[11px] font-black text-textSecondary">
          {props.kindLabel} · v{props.version}
        </span>
      </div>

      <div className="mt-4 whitespace-pre-wrap text-[13px] leading-relaxed text-textSecondary">
        {props.body}
      </div>
    </section>
  )
}

export default async function PublicConsentSigningPage(props: PageProps) {
  const resolvedParams = await Promise.resolve(props.params)
  const routeToken = pickString(resolvedParams?.token)
  if (!routeToken) notFound()

  let resolved: Awaited<ReturnType<typeof resolveConsentSignatureTokenForRead>>
  try {
    resolved = await resolveConsentSignatureTokenForRead({
      rawToken: routeToken,
    })
  } catch (error) {
    if (isBookingError(error)) {
      return <UnavailableCard />
    }
    throw error
  }

  // The kill switch reaches the CONTROL, not only the writer (K13-web's bug):
  // with the gate off for this pro the page offers nothing to press, and the
  // sign route refuses on the same condition.
  if (!isClientTechnicalRecordEnabled(resolved.professionalId)) {
    return <UnavailableCard />
  }

  const booking = resolved.booking
  const timeZone = sanitizeTimeZone(
    booking.locationTimeZone ?? booking.professional?.timeZone ?? 'UTC',
    'UTC',
  )
  const professionalLabel = formatProfessionalPublicDisplayName(
    booking.professional,
    'your professional',
  )
  const serviceTitle = booking.service?.name || 'Appointment'
  const whenLabel = formatWhen(booking.scheduledFor, timeZone)
  const tzLabel = friendlyTimeZoneLabel(timeZone) ?? timeZone
  const kindLabel = CONSENT_KIND_LABELS[resolved.version.formKind]

  const header = (
    <header className="rounded-card border border-textPrimary/10 bg-bgSecondary p-5">
      <span className="inline-flex items-center rounded-full border border-textPrimary/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
        Before your appointment
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

  const document = (
    <DocumentCard
      title={resolved.version.title}
      version={resolved.version.version}
      kindLabel={kindLabel}
      body={resolved.version.body}
    />
  )

  // Already signed through THIS link. Shown, not 404'd: re-reading what you
  // agreed to is a legitimate reason to open the link again, and is exactly why
  // the token is not single-use.
  if (resolved.signedRecord) {
    const signedAt = resolved.signedRecord.signedAt ?? resolved.signedRecord.createdAt

    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-20 pt-16 text-textPrimary">
        {header}
        <div className="mt-4">
          <StatusCard
            tone="success"
            title="You've signed this form"
            body={`Signed ${formatWhen(signedAt, timeZone)}. It's on file with ${professionalLabel} — the copy below is exactly what you agreed to.`}
          />
        </div>
        {document}
      </main>
    )
  }

  if (booking.status === BookingStatus.CANCELLED) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-20 pt-16 text-textPrimary">
        {header}
        <div className="mt-4">
          <StatusCard
            tone="danger"
            title="This booking was cancelled"
            body="There is nothing to sign for it. If you rebook, your professional can send a new form."
          />
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-20 pt-16 text-textPrimary">
      {header}
      {document}

      <div className="mt-4">
        <ConsentSignCard
          token={routeToken}
          formTitle={resolved.version.title}
          professionalLabel={professionalLabel}
        />
      </div>

      <section className="mt-4 text-xs text-textSecondary/75">
        <div className="font-black text-textSecondary">Need help?</div>
        <div className="mt-1">
          If anything here doesn&apos;t look right, reach out to{' '}
          {professionalLabel} before signing.
        </div>
      </section>
    </main>
  )
}
