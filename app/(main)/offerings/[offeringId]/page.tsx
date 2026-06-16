// app/(main)/offerings/[offeringId]/page.tsx
//
// Claim page for a last-minute opening. The destination for the links in the home invites,
// the last-minute notifications, and (later) the client openings feed. Loads + validates the
// opening, shows it priced with its incentive, and hands off to ClaimClient (hold → finalize).
import Link from 'next/link'
import {
  LastMinuteOfferType,
  OpeningStatus,
  ServiceLocationType,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { openingSelect } from '@/lib/lastMinute/openingSelect'
import {
  pickPublicTierPlan,
  pickRecipientTierPlan,
} from '@/lib/lastMinute/pickTierPlan'
import { moneyToString } from '@/lib/money'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import {
  buildLoginHref,
  formatProfessionLabel,
  formatPublicProfileDisplayName,
} from '@/lib/profiles/publicProfileFormatting'

import ClaimClient from './ClaimClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ offeringId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined): string | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function minuteMs(date: Date): number {
  const d = new Date(date)
  d.setSeconds(0, 0)
  return d.getTime()
}

const SECTION_CLASS =
  'relative mx-auto flex min-h-screen w-full max-w-none flex-col px-[22px] pb-28 pt-16 md:max-w-[520px] md:px-[32px] lg:max-w-[560px] lg:px-[40px]'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-bgPrimary text-textPrimary">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[200px] bg-[linear-gradient(180deg,rgb(var(--accent-primary)/0.12),transparent)]"
      />
      <section className={SECTION_CLASS}>{children}</section>
    </main>
  )
}

function UnavailableView() {
  return (
    <Shell>
      <div className="mt-10 rounded-card border border-textPrimary/10 bg-bgSurface p-6 text-center">
        <div className="font-display text-[20px] font-bold">This opening is no longer available</div>
        <p className="mt-2 text-[13px] leading-relaxed text-textMuted">
          It may have just been booked or expired. There may be other last-minute openings for you.
        </p>
        <Link
          href="/client"
          className="mt-5 inline-flex rounded-full bg-accentPrimary px-5 py-2.5 font-display text-[13px] font-bold text-onAccent transition hover:bg-accentPrimaryHover"
        >
          See more openings
        </Link>
      </div>
    </Shell>
  )
}

export default async function ClaimOpeningPage(props: PageProps) {
  const { offeringId } = await props.params
  const sp = props.searchParams ? await props.searchParams : {}
  const openingId = firstParam(sp.openingId)
  const scheduledForRaw = firstParam(sp.scheduledFor)

  const claimUrl = `/offerings/${encodeURIComponent(offeringId)}?${new URLSearchParams({
    ...(openingId ? { openingId } : {}),
    ...(scheduledForRaw ? { scheduledFor: scheduledForRaw } : {}),
    source: 'DISCOVERY',
  }).toString()}`

  const user = await getCurrentUser().catch(() => null)
  const clientId = user?.clientProfile?.id ?? null

  const opening = openingId
    ? await prisma.lastMinuteOpening.findUnique({
        where: { id: openingId },
        select: openingSelect,
      })
    : null

  const serviceRow = opening?.services.find((row) => row.offeringId === offeringId) ?? null
  const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : null

  const claimable = Boolean(
    opening &&
      serviceRow &&
      opening.status === OpeningStatus.ACTIVE &&
      !opening.bookedAt &&
      !opening.cancelledAt &&
      scheduledFor &&
      !Number.isNaN(scheduledFor.getTime()) &&
      minuteMs(scheduledFor) === minuteMs(opening.startAt),
  )

  if (!opening || !serviceRow || !claimable) {
    return <UnavailableView />
  }

  // Resolve the incentive the SAME way finalize charges it (recipient tier if notified, else
  // public) so the displayed price matches what the client will pay.
  const recipient = clientId
    ? await prisma.lastMinuteRecipient.findUnique({
        where: { openingId_clientId: { openingId: opening.id, clientId } },
        select: { notifiedTier: true, firstMatchedTier: true },
      })
    : null

  const tierPlan = recipient
    ? pickRecipientTierPlan({
        notifiedTier: recipient.notifiedTier,
        firstMatchedTier: recipient.firstMatchedTier,
        tierPlans: opening.tierPlans,
      })
    : pickPublicTierPlan(
        { visibilityMode: opening.visibilityMode, tierPlans: opening.tierPlans },
        new Date(),
      )

  const offering = serviceRow.offering
  const isMobile = opening.locationType === ServiceLocationType.MOBILE

  const baseStr =
    (isMobile
      ? moneyToString(offering.mobilePriceStartingAt)
      : moneyToString(offering.salonPriceStartingAt)) ??
    moneyToString(serviceRow.service.minPrice)
  const baseNum = baseStr ? Number(baseStr) : null

  let incentiveLabel: string | null = null
  let discountedStr: string | null = null
  if (tierPlan && baseNum != null && Number.isFinite(baseNum)) {
    if (tierPlan.offerType === LastMinuteOfferType.PERCENT_OFF && tierPlan.percentOff) {
      incentiveLabel = `${tierPlan.percentOff}% off`
      discountedStr = moneyToString(Math.max(0, baseNum * (1 - tierPlan.percentOff / 100)))
    } else if (tierPlan.offerType === LastMinuteOfferType.AMOUNT_OFF && tierPlan.amountOff) {
      const amount = Number(tierPlan.amountOff.toString())
      if (Number.isFinite(amount) && amount > 0) {
        incentiveLabel = `$${moneyToString(amount) ?? amount} off`
        discountedStr = moneyToString(Math.max(0, baseNum - amount))
      }
    } else if (
      tierPlan.offerType === LastMinuteOfferType.FREE_SERVICE ||
      tierPlan.offerType === LastMinuteOfferType.FREE_ADD_ON
    ) {
      // Not applied as a price discount in v1 — show a neutral marker, never a number we won't charge.
      incentiveLabel = 'Special offer'
    }
  }

  const serviceName = offering.title?.trim() || serviceRow.service.name
  const proName = formatPublicProfileDisplayName({
    businessName: opening.professional.businessName,
    fallback: 'Your pro',
  })
  const profession = formatProfessionLabel(opening.professional.professionType)
  const when = formatAppointmentWhen(opening.startAt, opening.timeZone)
  const place = isMobile
    ? 'Mobile'
    : [opening.location?.city, opening.location?.state].filter(Boolean).join(', ') || null
  const durationMin =
    (isMobile ? offering.mobileDurationMinutes : offering.salonDurationMinutes) ??
    serviceRow.service.defaultDurationMinutes

  let defaultAddressId: string | null = null
  if (clientId && isMobile) {
    const addr = await prisma.clientAddress.findFirst({
      where: { clientId, isDefault: true },
      select: { id: true },
    })
    defaultAddressId = addr?.id ?? null
  }

  return (
    <Shell>
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accentPrimary">
        🔔 Opening available
      </div>
      <h1 className="mt-3 font-display text-[36px] font-bold leading-[0.98] tracking-[-0.03em] md:text-[40px] lg:text-[44px]">
        {serviceName}
      </h1>
      <div className="mt-2 text-[14px] text-textMuted">
        {proName} · {profession}
      </div>

      <div className="mt-6 rounded-card border border-textPrimary/10 bg-bgSurface p-5">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-textMuted">When</dt>
            <dd className="mt-1 font-display text-[15px] font-semibold">{when}</dd>
          </div>
          <div>
            <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-textMuted">Where</dt>
            <dd className="mt-1 font-display text-[15px] font-semibold">{place ?? '—'}</dd>
          </div>
          {durationMin ? (
            <div>
              <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-textMuted">Duration</dt>
              <dd className="mt-1 font-display text-[15px] font-semibold">{durationMin} min</dd>
            </div>
          ) : null}
          <div>
            <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-textMuted">Price</dt>
            <dd className="mt-1 flex items-baseline gap-2">
              {discountedStr ? (
                <>
                  <span className="font-display text-[15px] font-bold text-accentPrimary">${discountedStr}</span>
                  {baseStr ? (
                    <span className="font-display text-[12px] font-semibold text-textMuted line-through">${baseStr}</span>
                  ) : null}
                </>
              ) : (
                <span className="font-display text-[15px] font-bold">{baseStr ? `$${baseStr}` : '—'}</span>
              )}
            </dd>
          </div>
        </dl>

        {incentiveLabel ? (
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accentPrimary/12 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-accentPrimary">
            ✦ {incentiveLabel}
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <ClaimClient
          offeringId={offeringId}
          openingId={opening.id}
          scheduledFor={opening.startAt.toISOString()}
          locationType={isMobile ? 'MOBILE' : 'SALON'}
          locationId={opening.locationId}
          defaultAddressId={defaultAddressId}
          isAuthed={Boolean(clientId)}
          loginHref={buildLoginHref(claimUrl)}
        />
      </div>
    </Shell>
  )
}
