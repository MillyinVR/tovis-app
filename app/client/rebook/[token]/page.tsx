import type { ReactNode } from 'react'
import { formatMoneyFromUnknown } from '@/lib/money'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AftercareRebookMode,
  BookingSource,
  BookingStatus,
  ClientClaimStatus,
  MediaPhase,
  MediaVisibility,
} from '@prisma/client'

import { CompletePaymentCard } from '@/app/client/_public/CompletePaymentCard'
import { CreateAccountInviteCard } from '@/app/client/_public/CreateAccountInviteCard'
import { RebookCard } from '@/app/client/_public/RebookCard'
import { getPublicCheckoutAvailability } from '@/lib/booking/publicCheckoutAvailability'
import { prisma } from '@/lib/prisma'
import { sanitizeTimeZone } from '@/lib/timeZone'
import {
  formatAppointmentWhen,
  formatRangeInTimeZone,
} from '@/lib/formatInTimeZone'
import { pickString } from '@/lib/pick'
import { resolveAftercareAccessByToken } from '@/lib/aftercare/unclaimedAftercareAccess'
import { isBookingError } from '@/lib/booking/errors'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import RemoteImage from '@/app/_components/media/RemoteImage'

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
          {props.items.map((item) => {
            const src = item.thumbUrl || item.url

            return (
              <div
                key={item.id}
                className="aspect-square overflow-hidden rounded-card border border-white/10 bg-bgPrimary"
              >
                {src ? (
                  <RemoteImage
                    src={src}
                    alt={props.title}
                    className="h-full w-full object-cover"
                    width={400}
                    height={400}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-textSecondary">
                    Unavailable
                  </div>
                )}
              </div>
            )
          })}
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
      label: `Next appointment booked: ${formatAppointmentWhen(bookedAt, timeZone)}`,
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
  const professionalLabel =
    booking.professional?.businessName || 'your professional'
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

  const rawMedia = await prisma.mediaAsset.findMany({
    where: {
      bookingId: booking.id,
      visibility: MediaVisibility.PRO_CLIENT,
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

  const beforeMedia = media.filter((item) => item.phase === MediaPhase.BEFORE)
  const afterMedia = media.filter((item) => item.phase === MediaPhase.AFTER)

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
          Original appointment:{' '}
          <span className="font-black text-textPrimary">
            {sourceAppointmentLabel}
          </span>
          <span className="opacity-70"> · {appointmentTimeZone}</span>
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
                : 'This appointment is paid in full. Thank you!'}
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

        <MediaStrip title="Before photos" items={beforeMedia} />
        <MediaStrip title="After photos" items={afterMedia} />

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
              <span className="opacity-70">· {appointmentTimeZone}</span>
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
          ) : offeringId ? (
            <div className="mt-2">
              <RebookCard
                token={routeToken}
                availability={{
                  professionalId: booking.professionalId,
                  serviceId: booking.serviceId ?? '',
                  locationType: booking.locationType,
                  locationId: booking.locationId ?? '',
                  clientAddressId: bookingLocation?.clientAddressId ?? null,
                }}
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