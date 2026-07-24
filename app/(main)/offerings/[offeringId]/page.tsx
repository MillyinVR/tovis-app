// app/(main)/offerings/[offeringId]/page.tsx
//
// Claim page for a last-minute opening. The destination for the links in the home invites,
// the last-minute notifications, and (later) the client openings feed. Loads + validates the
// opening, shows it priced with its incentive, and hands off to ClaimClient (hold → finalize).
import Link from 'next/link'

import { getCurrentUser } from '@/lib/currentUser'
import { buildLoginHref } from '@/lib/profiles/publicProfileFormatting'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { getProNoShowSettings } from '@/lib/noShowProtection/settings'
import { cancellationPolicyDisclosure } from '@/lib/noShowProtection/policyDisclosure'

import ClaimClient from './ClaimClient'
import PresenceSignals from './PresenceSignals'
import { loadOfferingDetail } from './_data/loadOfferingDetail'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ offeringId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined): string | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
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

  const detail = await loadOfferingDetail({
    offeringId,
    openingId,
    scheduledForRaw,
    clientId,
  })

  if (!detail.claimable) {
    return <UnavailableView />
  }

  const {
    serviceName,
    proName,
    profession,
    when,
    place,
    durationMin,
    baseStr,
    discountedStr,
    incentiveLabel,
    isMobile,
    defaultAddressId,
    locationId,
    scheduledForIso,
    professionalId,
    serviceId,
    openingId: resolvedOpeningId,
  } = detail

  // Pro's fee policy the client must agree to before claiming (M15).
  const cancellationPolicy = noShowProtectionEnabled()
    ? cancellationPolicyDisclosure(await getProNoShowSettings(professionalId))
    : null

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

      {/*
        The deal, as the loudest thing on the page. A pro creating a last-minute
        opening picks ONE incentive — percent off, dollar amount off, a free
        service, or a free add-on — and that is what makes the slot worth dropping
        everything for. The starting price isn't even final (the pro re-quotes at
        the appointment), so it has no business outshouting the offer. It used to
        be a small chip UNDER the price block.
      */}
      {incentiveLabel ? (
        <div className="mt-6 rounded-card bg-accentPrimary px-5 py-4 text-onAccent">
          <div className="font-display text-[30px] font-bold uppercase leading-[1.05] tracking-[-0.02em]">
            ✦ {incentiveLabel}
          </div>
          <div className="mt-0.5 text-[12.5px] font-medium text-onAccent/85">
            On this last-minute opening
          </div>
        </div>
      ) : null}

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
            {/*
              A STARTING price, never a set one. The underlying fields say so —
              salonPriceStartingAt / mobilePriceStartingAt / service.minPrice — and
              the pro sets the real price at the consultation, once they've seen the
              hair. A bare "$144" on the screen where someone commits to a booking
              reads as a quote, so the label, the "From" and the footnote below all
              say otherwise. The discount is real and applies to the final price.
            */}
            <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-textMuted">Starting at</dt>
            <dd className="mt-1 flex items-baseline gap-2">
              {discountedStr ? (
                <>
                  <span className="font-display text-[15px] font-bold text-accentPrimary">From ${discountedStr}</span>
                  {baseStr ? (
                    <span className="font-display text-[12px] font-semibold text-textMuted line-through">${baseStr}</span>
                  ) : null}
                </>
              ) : (
                <span className="font-display text-[15px] font-bold">{baseStr ? `From $${baseStr}` : '—'}</span>
              )}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-[12px] text-textMuted">
          Starting price — your pro confirms the final price at your appointment.
          {discountedStr ? ' Your discount applies to it.' : ''}
        </p>

        <PresenceSignals
          resourceType="opening"
          resourceId={resolvedOpeningId}
          professionalId={professionalId}
          serviceId={serviceId}
        />
      </div>

      <div className="mt-6">
        <ClaimClient
          offeringId={offeringId}
          openingId={resolvedOpeningId}
          scheduledFor={scheduledForIso}
          locationType={isMobile ? 'MOBILE' : 'SALON'}
          locationId={locationId}
          defaultAddressId={defaultAddressId}
          isAuthed={Boolean(clientId)}
          loginHref={buildLoginHref(claimUrl)}
          cancellationPolicy={cancellationPolicy}
        />
      </div>
    </Shell>
  )
}
