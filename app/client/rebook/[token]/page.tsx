import type { ReactNode } from 'react'
import { formatMoneyFromUnknown } from '@/lib/money'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AftercareRebookMode,
  BookingSource,
  BookingStatus,
  ClientAddressKind,
  ClientClaimStatus,
  MediaPhase,
  ServiceLocationType,
} from '@prisma/client'

import { CompletePaymentCard } from '@/app/client/_public/CompletePaymentCard'
import { CreateAccountInviteCard } from '@/app/client/_public/CreateAccountInviteCard'
import {
  RebookCard,
  type PublicRebookLocationMode,
  type PublicRebookSavedAddress,
} from '@/app/client/_public/RebookCard'
import {
  CLIENT_ADDRESS_SELECT,
  mapClientAddress,
  sortClientAddresses,
} from '@/lib/clientAddresses/addressInput'
import { getPublicCheckoutAvailability } from '@/lib/booking/publicCheckoutAvailability'
import { prisma } from '@/lib/prisma'
import { friendlyTimeZoneLabel, sanitizeTimeZone } from '@/lib/timeZone'
import {
  formatAppointmentWhen,
  formatRangeInTimeZone,
} from '@/lib/formatInTimeZone'
import { pickString } from '@/lib/pick'
import { resolveAftercareAccessByToken } from '@/lib/aftercare/unclaimedAftercareAccess'
import { isBookingError } from '@/lib/booking/errors'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { orderMediaByFeatured } from '@/lib/media/bookingBeforeAfter'
import ClickableMedia from '@/app/_components/media/ClickableMedia'
import AftercareBeforeAfter from '@/app/_components/aftercare/AftercareBeforeAfter'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

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
function MediaStrip(props: {
  title: string
  items: Array<{
    id: string
    url: string | null
    thumbUrl: string | null
    mediaType: string
  }>
}) {
  return (
    <SectionCard title={props.title}>
      {props.items.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {props.items.map((item) => (
            <ClickableMedia
              key={item.id}
              thumbSrc={item.thumbUrl || item.url}
              fullSrc={item.url || item.thumbUrl}
              mediaType={item.mediaType?.toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE'}
              alt={props.title}
              className="aspect-square w-full rounded-card border border-white/10 bg-bgPrimary"
            />
          ))}
        </div>
      ) : (
        <div className="text-sm text-textSecondary/75">No photos available.</div>
      )}
    </SectionCard>
  )
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
      label: `Next booking confirmed: ${formatAppointmentWhen(bookedAt, timeZone)}`,
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

/**
 * Saved service addresses the token's client can pick as the destination of a
 * MOBILE rebook. Loaded server-side — this page is already token-gated to the
 * client, so the public link needs no authenticated address API. Only rows the
 * write path can actually book (live coordinates + a formatted address) are
 * offered.
 */
async function loadBookableServiceAddresses(
  clientId: string,
): Promise<PublicRebookSavedAddress[]> {
  const rows = await prisma.clientAddress.findMany({
    where: {
      clientId,
      kind: ClientAddressKind.SERVICE_ADDRESS,
    },
    select: CLIENT_ADDRESS_SELECT,
  })

  return sortClientAddresses(rows)
    .map(mapClientAddress)
    .flatMap((address) =>
      address.lat != null && address.lng != null && address.formattedAddress
        ? [
            {
              id: address.id,
              label: address.label,
              formattedAddress: address.formattedAddress,
              isDefault: address.isDefault,
            },
          ]
        : [],
    )
}

function buildPublicRebookLocationModes(args: {
  originalType: ServiceLocationType
  originalLocationId: string
  clientAddressId: string | null
  offersInSalon: boolean | null
  offersMobile: boolean | null
  savedAddressCount: number
}): PublicRebookLocationMode[] {
  const {
    originalType,
    originalLocationId,
    clientAddressId,
    offersInSalon,
    offersMobile,
    savedAddressCount,
  } = args

  const salonMode: PublicRebookLocationMode = {
    type: 'SALON',
    label: 'In-salon',
    locationId:
      originalType === ServiceLocationType.SALON ? originalLocationId : '',
    clientAddressId: null,
  }

  const mobileMode: PublicRebookLocationMode = {
    type: 'MOBILE',
    label: 'Mobile',
    locationId:
      originalType === ServiceLocationType.MOBILE ? originalLocationId : '',
    clientAddressId,
  }

  // In-salon needs no client data; mobile needs a client address — either the
  // original visit's (cloned server-side) or any saved service address the
  // client can pick from. The original mode is always bookable.
  const salonFeasible =
    originalType === ServiceLocationType.SALON || offersInSalon === true
  const mobileFeasible =
    (Boolean(clientAddressId) || savedAddressCount > 0) &&
    (originalType === ServiceLocationType.MOBILE || offersMobile === true)

  const modes: PublicRebookLocationMode[] = []
  if (salonFeasible) modes.push(salonMode)
  if (mobileFeasible) modes.push(mobileMode)

  if (!modes.some((mode) => mode.type === originalType)) {
    modes.unshift(
      originalType === ServiceLocationType.MOBILE ? mobileMode : salonMode,
    )
  }

  return modes
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
  const professionalLabel = formatProfessionalPublicDisplayName(
    booking.professional,
    'your professional',
  )
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

  // clientAddressId is needed for MOBILE availability lookups (resolves
  // coordinates); null/unused for SALON bookings.
  const bookingLocation = await prisma.booking.findUnique({
    where: { id: booking.id },
    select: { clientAddressId: true },
  })

  // Which location modes the client can rebook into on this public link. The
  // original mode is always offered; the other is offered only when the pro
  // supports it AND we can actually book it here — mobile needs the client's
  // saved address, which exists only when the original visit was mobile.
  const offeringCaps = offeringId
    ? await prisma.professionalServiceOffering.findUnique({
        where: { id: offeringId },
        select: { offersInSalon: true, offersMobile: true },
      })
    : null

  const rebookClientAddressId = bookingLocation?.clientAddressId ?? null

  // Saved addresses power the mobile mode (and its picker) even when the
  // original visit was in-salon; skip the lookup when mobile isn't on the
  // table at all.
  const mobilePossible =
    booking.locationType === ServiceLocationType.MOBILE ||
    offeringCaps?.offersMobile === true
  const savedAddresses = mobilePossible
    ? await loadBookableServiceAddresses(booking.clientId)
    : []

  const locationModes = buildPublicRebookLocationModes({
    originalType: booking.locationType,
    originalLocationId: booking.locationId ?? '',
    clientAddressId: rebookClientAddressId,
    offersInSalon: offeringCaps?.offersInSalon ?? null,
    offersMobile: offeringCaps?.offersMobile ?? null,
    savedAddressCount: savedAddresses.length,
  })

  const inviteClient = await prisma.clientProfile.findUnique({
    where: { id: booking.clientId },
    select: { claimStatus: true, userId: true },
  })

  const showAccountInvite =
    inviteClient != null &&
    inviteClient.userId == null &&
    inviteClient.claimStatus === ClientClaimStatus.UNCLAIMED

  const checkoutParam = pickSearchParam(resolvedSearchParams.checkout)
  const checkoutAvailability = await getPublicCheckoutAvailability({
    bookingId: booking.id,
    clientId: booking.clientId,
  })
  const paymentSettled =
    checkoutAvailability.status === 'ALREADY_PAID' || checkoutParam === 'success'

  // The client reached this page with a valid access token for THIS booking, so
  // they're entitled to their own visit's before/after photos regardless of
  // visibility. Do NOT filter by `visibility` here: when a pro features a
  // before/after photo to their portfolio (or publishes it as a look) its
  // visibility flips PRO_CLIENT → PUBLIC (see computeVisibility in
  // app/api/v1/pro/media/[id]/portfolio/route.ts), so a `PRO_CLIENT`-only filter
  // would silently drop that photo from the client's aftercare summary while it
  // still shows on every other surface. Matches the gated booking page
  // (loadClientBookingPage) and the shared before/after loader
  // (lib/media/bookingBeforeAfter), neither of which filters on visibility.
  const rawMedia = await prisma.mediaAsset.findMany({
    where: {
      bookingId: booking.id,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,
      url: true,
      thumbUrl: true,
      mediaType: true,
      phase: true,
    },
  })

  const media = await Promise.all(
    rawMedia.map(async (row) => {
      const { renderUrl, renderThumbUrl } = await renderMediaUrls(row)
      return {
        id: row.id,
        url: renderUrl,
        thumbUrl: renderThumbUrl,
        mediaType: row.mediaType,
        phase: row.phase,
      }
    }),
  )

  // Pro-chosen featured pair first (falls back to the earliest when unset), so
  // it renders as the primary before/after comparison and the rest trail as
  // flat thumbnails.
  const beforeMedia = orderMediaByFeatured(
    media.filter((item) => item.phase === MediaPhase.BEFORE),
    aftercare.featuredBeforeAssetId,
  )
  const afterMedia = orderMediaByFeatured(
    media.filter((item) => item.phase === MediaPhase.AFTER),
    aftercare.featuredAfterAssetId,
  )

  // The reveal comparison is image-only; pick the first image of each phase as
  // the featured half and let everything else (incl. videos) fall to the
  // thumbnail strips below.
  const isImageMedia = (item: { mediaType: string }) =>
    item.mediaType?.toUpperCase() !== 'VIDEO'
  const featuredBefore = beforeMedia.find(isImageMedia) ?? null
  const featuredAfter = afterMedia.find(isImageMedia) ?? null
  const hasFeaturedComparison = Boolean(featuredBefore || featuredAfter)
  const beforeExtras = beforeMedia.filter((item) => item.id !== featuredBefore?.id)
  const afterExtras = afterMedia.filter((item) => item.id !== featuredAfter?.id)

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
          Original booking:{' '}
          <span className="font-black text-textPrimary">
            {sourceAppointmentLabel}
          </span>
          <span className="opacity-70"> · {friendlyTimeZoneLabel(appointmentTimeZone) ?? appointmentTimeZone}</span>
        </div>

        <div className="mt-2 text-xs text-textSecondary/80">
          No account required to view aftercare and rebook from this secure link.
        </div>
      </header>

      <div className="mt-4 grid gap-3">
        {paymentSettled ? (
          <section className="rounded-card border border-toneSuccess/20 bg-toneSuccess/5 p-5">
            <div className="text-[14px] font-black text-textPrimary">
              Payment received
            </div>
            <div className="mt-1 text-sm text-textSecondary">
              {checkoutParam === 'success' &&
              checkoutAvailability.status !== 'ALREADY_PAID'
                ? 'Thanks! We’re finalizing your payment — this can take a moment to confirm.'
                : 'This booking is paid in full. Thank you!'}
            </div>
          </section>
        ) : checkoutAvailability.status === 'PAYABLE' ? (
          <>
            {checkoutParam === 'cancelled' ? (
              <section className="rounded-card border border-toneWarn/20 bg-toneWarn/5 px-4 py-3 text-sm text-textSecondary">
                Checkout was canceled. You can complete your payment below
                whenever you’re ready.
              </section>
            ) : null}
            <CompletePaymentCard
              token={routeToken}
              amountCents={checkoutAvailability.amountCents ?? 0}
              currency={checkoutAvailability.currency ?? 'usd'}
            />
          </>
        ) : null}

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

        {hasFeaturedComparison ? (
          <>
            <SectionCard title="Before &amp; after">
              <AftercareBeforeAfter
                media={{
                  beforeUrl: featuredBefore
                    ? featuredBefore.thumbUrl || featuredBefore.url
                    : null,
                  afterUrl: featuredAfter
                    ? featuredAfter.thumbUrl || featuredAfter.url
                    : null,
                  beforeFullUrl: featuredBefore
                    ? featuredBefore.url || featuredBefore.thumbUrl
                    : null,
                  afterFullUrl: featuredAfter
                    ? featuredAfter.url || featuredAfter.thumbUrl
                    : null,
                }}
                serviceName={serviceTitle}
              />
            </SectionCard>
            {beforeExtras.length > 0 ? (
              <MediaStrip title="More before photos" items={beforeExtras} />
            ) : null}
            {afterExtras.length > 0 ? (
              <MediaStrip title="More after photos" items={afterExtras} />
            ) : null}
          </>
        ) : (
          <>
            <MediaStrip title="Before photos" items={beforeMedia} />
            <MediaStrip title="After photos" items={afterMedia} />
          </>
        )}

        <SectionCard
          title="Booking details"
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
              <span className="opacity-70">· {friendlyTimeZoneLabel(appointmentTimeZone) ?? appointmentTimeZone}</span>
            </div>
          ) : (
            <div className="text-sm text-textSecondary/75">
              No rebook recommendation yet.
            </div>
          )}

          {nextBooking ? (
            <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary p-4">
              <div className="text-sm font-black text-textPrimary">
                Your next booking is already confirmed
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
          ) : offeringId ? (
            <div className="mt-2">
              <RebookCard
                token={routeToken}
                professionalId={booking.professionalId}
                serviceId={booking.serviceId ?? ''}
                timeZone={appointmentTimeZone}
                windowStartIso={
                  rebookInfo.mode === 'RECOMMENDED_WINDOW'
                    ? rebookInfo.windowStart.toISOString()
                    : null
                }
                windowEndIso={
                  rebookInfo.mode === 'RECOMMENDED_WINDOW'
                    ? rebookInfo.windowEnd.toISOString()
                    : null
                }
                locationModes={locationModes}
                initialLocationType={booking.locationType}
                savedAddresses={savedAddresses}
              />

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

        {showAccountInvite ? (
          <CreateAccountInviteCard actionToken={routeToken} context="aftercare" />
        ) : null}

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
                {formatAppointmentWhen(accessToken.expiresAt, appointmentTimeZone)}
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