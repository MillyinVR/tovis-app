// app/claim/[token]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ClientClaimStatus,
  Prisma,
  ProClientInviteStatus,
} from '@prisma/client'

import { acceptProClientClaimLink } from '@/lib/claims/proClientClaim'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { getCurrentUser } from '@/lib/currentUser'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type SearchParamsInput = Record<string, string | string[] | undefined>

type PageProps = {
  params: { token: string } | Promise<{ token: string }>
  searchParams?: SearchParamsInput | Promise<SearchParamsInput | undefined>
}

type ClaimPageState =
  | 'ready'
  | 'revoked'
  | 'already-claimed'
  | 'client-mismatch'
  | 'conflict'

const claimInviteSelect = Prisma.validator<Prisma.ProClientInviteSelect>()({
  id: true,
  token: true,
  clientId: true,
  professionalId: true,
  bookingId: true,
  invitedName: true,
  invitedEmail: true,
  invitedPhone: true,
  preferredContactMethod: true,
  status: true,
  acceptedAt: true,
  revokedAt: true,
  client: {
    select: {
      id: true,
      claimStatus: true,
    },
  },
  booking: {
    select: {
      id: true,
      clientId: true,
      scheduledFor: true,
      locationTimeZone: true,
      service: {
        select: {
          name: true,
        },
      },
      professional: {
        select: {
          id: true,
          businessName: true,
          location: true,
          timeZone: true,
          user: {
            select: {
              email: true,
            },
          },
        },
      },
      location: {
        select: {
          name: true,
          formattedAddress: true,
          city: true,
          state: true,
          timeZone: true,
        },
      },
    },
  },
})

type ClaimInviteRecord = Prisma.ProClientInviteGetPayload<{
  select: typeof claimInviteSelect
}>

function claimHref(token: string): string {
  return `/claim/${encodeURIComponent(token)}`
}

function loginHref(token: string): string {
  return `/login?from=${encodeURIComponent(claimHref(token))}`
}

function verifyHref(token: string): string {
  return `/verify-phone?next=${encodeURIComponent(claimHref(token))}`
}

function bookingHref(bookingId: string): string {
  return `/client/bookings/${encodeURIComponent(bookingId)}`
}

function pickSearchParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return pickString(value[0] ?? null)
  }
  return pickString(value ?? null)
}

function parsePageState(value: string | null): ClaimPageState | null {
  if (
    value === 'ready' ||
    value === 'revoked' ||
    value === 'already-claimed' ||
    value === 'client-mismatch' ||
    value === 'conflict'
  ) {
    return value
  }
  return null
}

function isInviteRevoked(
  invite: Pick<ClaimInviteRecord, 'status' | 'revokedAt'>,
): boolean {
  return (
    invite.status === ProClientInviteStatus.REVOKED ||
    invite.revokedAt != null
  )
}

function isClientClaimed(
  invite: Pick<ClaimInviteRecord, 'client'>,
): boolean {
  return invite.client?.claimStatus === ClientClaimStatus.CLAIMED
}

function buildLocationLabel(booking: ClaimInviteRecord['booking']): string | null {
  const formattedAddress = booking.location?.formattedAddress?.trim()
  if (formattedAddress) return formattedAddress

  const locationName = booking.location?.name?.trim()
  if (locationName) return locationName

  const cityState = [booking.location?.city, booking.location?.state]
    .filter(Boolean)
    .join(', ')
    .trim()
  if (cityState) return cityState

  const professionalLocation = booking.professional?.location?.trim()
  if (professionalLocation) return professionalLocation

  return null
}

function buildProfessionalLabel(
  booking: ClaimInviteRecord['booking'],
): string {
  return (
    booking.professional?.businessName?.trim() ||
    booking.professional?.user?.email?.trim() ||
    'your professional'
  )
}

function buildAppointmentLabel(
  booking: ClaimInviteRecord['booking'],
): string | null {
  const timeZone = sanitizeTimeZone(
    booking.locationTimeZone ??
      booking.location?.timeZone ??
      booking.professional?.timeZone,
    'UTC',
  )

  if (!(booking.scheduledFor instanceof Date)) return null

  return `${formatAppointmentWhen(booking.scheduledFor, timeZone)} · ${timeZone}`
}

function StatusCard(props: {
  title: string
  body: string
  tone?: 'neutral' | 'warning'
  children?: React.ReactNode
}) {
  const tone = props.tone ?? 'neutral'

  return (
    <section
      className={cn(
        'rounded-card border p-4',
        tone === 'warning'
          ? 'border-amber-400/20 bg-amber-500/10'
          : 'border-surfaceGlass/10 bg-bgSecondary',
      )}
    >
      <div className="text-sm font-black text-textPrimary">{props.title}</div>
      <div className="mt-2 text-sm text-textSecondary">{props.body}</div>
      {props.children ? <div className="mt-4">{props.children}</div> : null}
    </section>
  )
}

export default async function ClaimInvitePage(props: PageProps) {
const resolvedParams = await Promise.resolve(props.params)
const rawToken = pickString(resolvedParams?.token)
if (!rawToken) notFound()
const token: string = rawToken

  const resolvedSearchParams =
    (await Promise.resolve(props.searchParams).catch(() => undefined)) ?? {}
  const stateFromQuery = parsePageState(
    pickSearchParam(resolvedSearchParams.state),
  )

  const invite = await prisma.proClientInvite.findUnique({
    where: { token },
    select: claimInviteSelect,
  })

  if (!invite?.client || !invite.booking) notFound()

  const user = await getCurrentUser().catch(() => null)

  const isAuthedClient =
    user?.role === 'CLIENT' && Boolean(user.clientProfile?.id)
  const currentClientId = isAuthedClient ? user.clientProfile?.id ?? null : null
  const isMatchingClient =
    currentClientId != null && currentClientId === invite.client.id
  const needsVerification =
    Boolean(isMatchingClient) &&
    (user?.sessionKind !== 'ACTIVE' || !user?.isFullyVerified)

  const revoked = isInviteRevoked(invite)
  const alreadyClaimed = isClientClaimed(invite)

  let pageState: ClaimPageState = 'ready'
  if (revoked) {
    pageState = 'revoked'
  } else if (alreadyClaimed) {
    pageState = 'already-claimed'
  } else if (isAuthedClient && !isMatchingClient) {
    pageState = 'client-mismatch'
  } else if (stateFromQuery) {
    pageState = stateFromQuery
  }

  async function claimAction() {
    'use server'

    const freshUser = await getCurrentUser().catch(() => null)
    if (
      !freshUser ||
      freshUser.role !== 'CLIENT' ||
      !freshUser.clientProfile?.id
    ) {
      redirect(loginHref(token))
    }

    if (freshUser.sessionKind !== 'ACTIVE' || !freshUser.isFullyVerified) {
      redirect(verifyHref(token))
    }

    const result = await acceptProClientClaimLink({
      token,
      actingUserId: freshUser.id,
      actingClientId: freshUser.clientProfile.id,
    })

    switch (result.kind) {
      case 'ok':
        redirect(bookingHref(result.bookingId))

      case 'not_found':
        notFound()

      case 'revoked':
        redirect(`${claimHref(token)}?state=revoked`)

      case 'already_claimed':
        redirect(`${claimHref(token)}?state=already-claimed`)

      case 'client_not_found':
        redirect(loginHref(token))

      case 'client_mismatch':
        redirect(`${claimHref(token)}?state=client-mismatch`)

      case 'conflict':
        redirect(`${claimHref(token)}?state=conflict`)
    }
  }

  const serviceTitle = invite.booking.service?.name?.trim() || 'Service'
  const professionalLabel = buildProfessionalLabel(invite.booking)
  const locationLabel = buildLocationLabel(invite.booking)
  const appointmentLabel = buildAppointmentLabel(invite.booking)
  const loginLink = loginHref(token)
  const verifyLink = verifyHref(token)
  const backToBookingHref = bookingHref(invite.booking.id)

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-16 text-textPrimary">
      <header>
        <div className="inline-flex rounded-full border border-surfaceGlass/10 bg-bgSecondary px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-textSecondary">
          Claim your client history
        </div>

        <h1 className="mt-4 text-[24px] font-black leading-tight">
          {serviceTitle} with {professionalLabel}
        </h1>

        <div className="mt-2 text-sm text-textSecondary">
          {invite.invitedName ? (
            <>
              This link was sent for{' '}
              <span className="font-black text-textPrimary">
                {invite.invitedName}
              </span>
              .
            </>
          ) : (
            'This link is ready to claim.'
          )}
        </div>

        {appointmentLabel ? (
          <div className="mt-3 text-sm text-textSecondary">
            Appointment: <span className="font-black text-textPrimary">{appointmentLabel}</span>
          </div>
        ) : null}

        {locationLabel ? (
          <div className="mt-1 text-sm text-textSecondary">
            Location: <span className="font-black text-textPrimary">{locationLabel}</span>
          </div>
        ) : null}
      </header>

      <section className="mt-6 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
        <div className="text-xs font-black text-textSecondary">What this claim keeps together</div>
        <div className="mt-2 text-sm text-textSecondary">
          Your booking history, aftercare, payments, and rebook context stay attached
          to the same client identity.
        </div>

        {(invite.invitedEmail || invite.invitedPhone) ? (
          <div className="mt-3 text-xs text-textSecondary/80">
            {invite.invitedEmail ? (
              <div>Email on file: {invite.invitedEmail}</div>
            ) : null}
            {invite.invitedPhone ? (
              <div>Phone on file: {invite.invitedPhone}</div>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="mt-4 space-y-4">
        {pageState === 'revoked' ? (
          <StatusCard
            title="This claim link is no longer available"
            body="This link was revoked by admin or system policy. Booking history is still preserved, but this specific link can’t be used anymore."
            tone="warning"
          />
        ) : null}

        {pageState === 'already-claimed' ? (
          <StatusCard
            title="This client history is already claimed"
            body="The client identity behind this link has already been claimed. If this is your account, go to your bookings to continue."
          >
            {isMatchingClient ? (
              <Link
                href={backToBookingHref}
                className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
              >
                Go to booking
              </Link>
            ) : null}
          </StatusCard>
        ) : null}

        {pageState === 'client-mismatch' ? (
          <StatusCard
            title="You are signed into a different client account"
            body="This claim link belongs to a different client identity than the one currently signed in. Use the correct client account to finish claiming this history."
            tone="warning"
          >
            <Link
              href={loginLink}
              className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/12 bg-bgPrimary px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-surfaceGlass"
            >
              Continue with a different account
            </Link>
          </StatusCard>
        ) : null}

        {pageState === 'conflict' ? (
          <StatusCard
            title="We could not finish the claim"
            body="Nothing was deleted. Please try again. If this keeps happening, support should inspect the client identity and invite audit state."
            tone="warning"
          />
        ) : null}

        {pageState === 'ready' ? (
          <section className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
            <div className="text-sm font-black text-textPrimary">
              Ready to claim
            </div>

            {!user ? (
              <>
                <div className="mt-2 text-sm text-textSecondary">
                  Sign in as the client for this link to claim your history.
                </div>

                <div className="mt-4">
                  <Link
                    href={loginLink}
                    className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Sign in to continue
                  </Link>
                </div>
              </>
            ) : !isAuthedClient ? (
              <>
                <div className="mt-2 text-sm text-textSecondary">
                  This link must be claimed from a client account.
                </div>

                <div className="mt-4">
                  <Link
                    href={loginLink}
                    className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Continue as client
                  </Link>
                </div>
              </>
            ) : needsVerification ? (
              <>
                <div className="mt-2 text-sm text-textSecondary">
                  Verify your account first, then come right back here to finish the claim.
                </div>

                <div className="mt-4">
                  <Link
                    href={verifyLink}
                    className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Verify and continue
                  </Link>
                </div>
              </>
            ) : isMatchingClient ? (
              <>
                <div className="mt-2 text-sm text-textSecondary">
                  This will attach this history to your client identity.
                </div>

                <form action={claimAction} className="mt-4">
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Claim this history
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="mt-2 text-sm text-textSecondary">
                  This link is valid, but it does not match the client account currently signed in.
                </div>

                <div className="mt-4">
                  <Link
                    href={loginLink}
                    className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/12 bg-bgPrimary px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-surfaceGlass"
                  >
                    Use a different account
                  </Link>
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>

      <section className="mt-5 text-xs text-textSecondary/75">
        <div className="font-black text-textSecondary">Claim link</div>
        <div className="mt-1 break-all">{claimHref(token)}</div>
      </section>
    </main>
  )
}