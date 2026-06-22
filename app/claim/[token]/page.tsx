// app/claim/[token]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ClientClaimStatus, ProClientInviteStatus } from '@prisma/client'

import { acceptClientClaimFromLink } from '@/lib/clients/clientClaim'
import {
  getClientClaimLinkPublicState,
  type ClientClaimLinkRow,
} from '@/lib/clients/clientClaimLinks'
import { normalizeProClientInviteToken } from '@/lib/clients/proClientInviteTokens'
import { getCurrentUser } from '@/lib/currentUser'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { pickString } from '@/lib/pick'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
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

type ClaimInviteRecord = ClientClaimLinkRow

function claimHref(token: string): string {
  return `/claim/${encodeURIComponent(token)}`
}

function buildClaimAuthParams(args: {
  token: string
  invitedName?: string | null
  invitedEmail?: string | null
  invitedPhone?: string | null
}): string {
  const params = new URLSearchParams()
  const claimPath = claimHref(args.token)

  params.set('from', claimPath)
  params.set('next', claimPath)
  params.set('role', 'CLIENT')
  params.set('intent', 'CLAIM_INVITE')
  params.set('inviteToken', args.token)

  const invitedName = pickString(args.invitedName)
  const invitedEmail = pickString(args.invitedEmail)
  const invitedPhone = pickString(args.invitedPhone)

  if (invitedName) params.set('name', invitedName)
  if (invitedEmail) params.set('email', invitedEmail)
  if (invitedPhone) params.set('phone', invitedPhone)

  return params.toString()
}

function loginHref(token: string): string {
  return `/login?from=${encodeURIComponent(claimHref(token))}`
}

function signupHref(invite: ClaimInviteRecord, token: string): string {
  return `/signup?${buildClaimAuthParams({
    token,
    invitedName: invite.invitedName,
    invitedEmail: invite.invitedEmail,
    invitedPhone: invite.invitedPhone,
  })}`
}

function verifyHref(token: string): string {
  return `/verify-phone?next=${encodeURIComponent(claimHref(token))}`
}

function bookingHref(bookingId: string): string {
  return `/client/bookings/${encodeURIComponent(bookingId)}`
}

function pickSearchParam(value: string | string[] | undefined): string | null {
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

function isClientClaimed(invite: Pick<ClaimInviteRecord, 'client'>): boolean {
  return invite.client?.claimStatus === ClientClaimStatus.CLAIMED
}

function buildLocationLabel(
  booking: NonNullable<ClaimInviteRecord['booking']>,
): string | null {
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
  booking: NonNullable<ClaimInviteRecord['booking']>,
): string {
  return formatProfessionalPublicDisplayName(
    booking.professional ?? null,
    'your professional',
  )
}

function buildAppointmentLabel(
  booking: NonNullable<ClaimInviteRecord['booking']>,
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
          ? 'border-toneWarn/20 bg-toneWarn/10'
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
  const normalizedToken = normalizeProClientInviteToken(resolvedParams?.token)

  if (!normalizedToken) {
    notFound()
  }

  const token: string = normalizedToken

  const resolvedSearchParams =
    (await Promise.resolve(props.searchParams).catch(() => undefined)) ?? {}

  const stateFromQuery = parsePageState(
    pickSearchParam(resolvedSearchParams.state),
  )

  const inviteState = await getClientClaimLinkPublicState({ token })

  if (inviteState.kind === 'not_found') {
    notFound()
  }

  const invite = inviteState.link

  if (!invite.client || !invite.booking) {
    notFound()
  }

  const user = await getCurrentUser().catch(() => null)

  const isAuthedClient =
    user?.role === 'CLIENT' && Boolean(user.clientProfile?.id)
  const currentClientId = isAuthedClient ? user.clientProfile?.id ?? null : null
  const isMatchingClient =
    currentClientId != null && currentClientId === invite.client.id
  const needsVerification =
    Boolean(isMatchingClient) &&
    (user?.sessionKind !== 'ACTIVE' || !user?.isFullyVerified)

  const revoked = inviteState.kind === 'revoked' || isInviteRevoked(invite)
  const alreadyClaimed =
    inviteState.kind === 'already_claimed' || isClientClaimed(invite)

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

  const loginLink = loginHref(token)
  const signupLink = signupHref(invite, token)
  const verifyLink = verifyHref(token)
  const backToBookingHref = bookingHref(invite.booking.id)

  async function claimAction() {
    'use server'

    const freshUser = await getCurrentUser().catch(() => null)

    if (
      !freshUser ||
      freshUser.role !== 'CLIENT' ||
      !freshUser.clientProfile?.id
    ) {
      redirect(signupLink)
    }

    if (freshUser.sessionKind !== 'ACTIVE' || !freshUser.isFullyVerified) {
      redirect(verifyHref(token))
    }

    const result = await acceptClientClaimFromLink({
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
        redirect(signupLink)

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

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-16 text-textPrimary">
      <header>
        <div className="inline-flex rounded-full border border-surfaceGlass/10 bg-bgSecondary px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-textSecondary">
          Your booking
        </div>

        <h1 className="mt-4 text-[24px] font-black leading-tight">
          {serviceTitle} with {professionalLabel}
        </h1>

        <div className="mt-2 text-sm text-textSecondary">
          {invite.invitedName ? (
            <>
              This booking was created for{' '}
              <span className="font-black text-textPrimary">
                {invite.invitedName}
              </span>
              .
            </>
          ) : (
            'Here are the details for your booking.'
          )}
        </div>

        {appointmentLabel ? (
          <div className="mt-3 text-sm text-textSecondary">
            Booking:{' '}
            <span className="font-black text-textPrimary">
              {appointmentLabel}
            </span>
          </div>
        ) : null}

        {locationLabel ? (
          <div className="mt-1 text-sm text-textSecondary">
            Location:{' '}
            <span className="font-black text-textPrimary">
              {locationLabel}
            </span>
          </div>
        ) : null}
      </header>

      <section className="mt-6 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
        <div className="text-xs font-black text-textSecondary">
          What this claim keeps together
        </div>
        <div className="mt-2 text-sm text-textSecondary">
          Your booking history, aftercare, payments, and rebook context stay
          attached to the same client identity.
        </div>

        {invite.invitedEmail || invite.invitedPhone ? (
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
            <div className="flex flex-wrap gap-3">
              <Link
                href={loginLink}
                className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/12 bg-bgPrimary px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-surfaceGlass"
              >
                Continue with a different account
              </Link>

              <Link
                href={signupLink}
                className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
              >
                Create a new client account
              </Link>
            </div>
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
              {!user ? 'Claim your client history' : 'Ready to claim'}
            </div>

            {!user ? (
              <>
                <div className="mt-2 text-sm text-textSecondary">
                  Your booking details are shown above — no account needed to
                  view them. Create a free account to manage this booking,
                  message your professional, and keep your history together.
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href={signupLink}
                    className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Create client account
                  </Link>

                  <Link
                    href={loginLink}
                    className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/12 bg-bgPrimary px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-surfaceGlass"
                  >
                    I already have an account
                  </Link>
                </div>
              </>
            ) : !isAuthedClient ? (
              <>
                <div className="mt-2 text-sm text-textSecondary">
                  This link must be claimed from a client account.
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href={loginLink}
                    className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Continue as client
                  </Link>

                  <Link
                    href={signupLink}
                    className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/12 bg-bgPrimary px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-surfaceGlass"
                  >
                    Create a client account
                  </Link>
                </div>
              </>
            ) : needsVerification ? (
              <>
                <div className="mt-2 text-sm text-textSecondary">
                  Verify your account first, then come right back here to finish
                  the claim.
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
                  This link is valid, but it does not match the client account
                  currently signed in.
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    href={loginLink}
                    className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/12 bg-bgPrimary px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-surfaceGlass"
                  >
                    Use a different account
                  </Link>

                  <Link
                    href={signupLink}
                    className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Create a new client account
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