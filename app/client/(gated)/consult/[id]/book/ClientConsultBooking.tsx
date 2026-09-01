'use client'

// Book the Look, slice B4b — the client's booking door on a look-anchored
// consult.
//
// 🔴 EVERY NUMBER AND EVERY PROMISE ON THIS SCREEN IS SERVER-COMPOSED. The price
// label, the estimate framing, the "your pro makes the final call" line, the
// line items, the total duration and the what-happens-when-you-tap sentence all
// arrive on `ConsultBookingProposalDTO`; the last of those is routed through the
// same `getClientSubmittedBookingStatus` fork the commit runs. Nothing here
// re-derives a price, a duration, a mode's availability or an acceptance mode.
//
// A LOOK never names the service that produced it (B1). The line names below are
// the pro's own menu answering "what is this appointment made of" AFTER a
// consultation, which is the pro's half of decision 6 arriving in the client's
// hands as the shape of her booking — not a taxonomy she picked from.

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'

import AvailabilityDrawer from '@/app/(main)/booking/AvailabilityDrawer'
import type { DrawerContext } from '@/app/(main)/booking/AvailabilityDrawer/types'
import type { BrandClientConsultBookingCopy } from '@/lib/brand/types'
import type {
  ConsultBookingProposalAvailabilityDTO,
  ConsultBookingProposalDTO,
} from '@/lib/dto/consult'
import { messageStartHref } from '@/lib/messages'
import { formatRoundedDollars } from '@/lib/money'
import { useViewerLocation } from '@/lib/useViewerLocation'
import { viewerLocationToDrawerContextFields } from '@/lib/viewerLocation'

import ClientPage from '../../../_components/ClientPage'

type Mode = 'SALON' | 'MOBILE'

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—'
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/**
 * Decision 5, rendered: the number NEVER stands on its own. `startingAtLabel` is
 * composed server-side (lib/looks/startingPrice.ts) and is null when the total is
 * not positive, which every surface renders as no price rather than "$0" — so the
 * framing lines stay even then, because "we can't quote this" still needs "your
 * pro makes the final call" beside it.
 */
function StartingAtBlock({ proposal }: { proposal: ConsultBookingProposalDTO }) {
  return (
    <div className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary px-4 py-3">
      {proposal.startingAtLabel ? (
        <div className="text-[22px] font-black leading-none text-textPrimary">
          {proposal.startingAtLabel}
        </div>
      ) : null}
      <p className="mt-2 text-[12px] font-semibold leading-5 text-textSecondary">
        {proposal.estimateNote} {proposal.proDecidesNote}
      </p>
    </div>
  )
}

function ModeButton({
  mode,
  label,
  selected,
  unavailableLabel,
  available,
  onSelect,
}: {
  mode: Mode
  label: string
  selected: boolean
  unavailableLabel: string
  available: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`consult-proposal-mode-${mode}`}
      className={[
        'rounded-xl border px-4 py-3 text-left transition',
        selected
          ? 'border-accentPrimary bg-accentPrimary/12'
          : 'border-surfaceGlass/12 bg-bgPrimary hover:bg-surfaceGlass/6',
      ].join(' ')}
    >
      <span className="block text-[13px] font-black text-textPrimary">
        {label}
      </span>
      {/* An unavailable mode stays TAPPABLE on purpose: selecting it renders the
          typed reason it can't be booked, which is the explained state the
          quality bar asks for. A greyed-out button explains nothing. */}
      {available ? null : (
        <span className="mt-1 block text-[11px] font-semibold text-textMuted">
          {unavailableLabel}
        </span>
      )}
    </button>
  )
}

export default function ClientConsultBooking({
  consultId,
  salon,
  mobile,
  copy,
}: {
  consultId: string
  salon: ConsultBookingProposalAvailabilityDTO
  mobile: ConsultBookingProposalAvailabilityDTO
  copy: BrandClientConsultBookingCopy
}) {
  // Deliberately no default. The server refuses to guess a mode, and so does
  // this screen: a salon price handed to someone who meant mobile is exactly
  // what B4's mode reconciliation exists to prevent.
  const [mode, setMode] = useState<Mode | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const viewerLoc = useViewerLocation()

  const answer = mode === 'SALON' ? salon : mode === 'MOBILE' ? mobile : null
  const proposal = answer?.proposal ?? null

  // Present on refusals too, so every dead end has the same way out.
  const professionalId = salon.professionalId

  const drawerContext = useMemo((): DrawerContext | null => {
    if (!proposal) return null

    return {
      professionalId: proposal.professionalId,
      serviceId: proposal.serviceId,
      offeringId: proposal.offeringId,
      lookPostId: proposal.lookPostId,
      // The booking came from a look, so it carries the discovery reference the
      // finalize attributes it to — the same shape the feed's drawer sends.
      source: 'DISCOVERY',
      // 🔴 The whole point: the grid, the hold and the finalize are all sized by
      // this consult's proposal rather than by the floor offering's base.
      consultId: proposal.consultId,
      // ...and for the mode this proposal was derived under. The sheet's own
      // salon/mobile toggle would otherwise re-ask a question already answered
      // above, and show times for a proposal she has never seen.
      lockedLocationType: proposal.locationType,
      ...viewerLocationToDrawerContextFields(viewerLoc),
    }
  }, [proposal, viewerLoc])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  const refusalMessage =
    answer && !answer.available
      ? (answer.reason && copy.refusalMessages[answer.reason]) ||
        copy.refusalMessageUnknown
      : null

  return (
    <ClientPage
      eyebrow={copy.eyebrow}
      title={copy.title}
      lede={copy.intro}
      back={{
        href: `/client/consult/${encodeURIComponent(consultId)}/results`,
        label: copy.backToResults,
      }}
      width="wide"
    >
      <div className="grid gap-6">
        <section
          aria-labelledby={`${consultId}-mode`}
          className="rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5"
        >
          <h2
            id={`${consultId}-mode`}
            className="text-base font-black text-textPrimary"
          >
            {copy.modeTitle}
          </h2>
          <p className="mt-1 text-sm text-textSecondary">{copy.modeBody}</p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ModeButton
              mode="SALON"
              label={copy.modeSalonLabel}
              selected={mode === 'SALON'}
              available={salon.available}
              unavailableLabel={copy.modeUnavailableLabel}
              onSelect={() => setMode('SALON')}
            />
            <ModeButton
              mode="MOBILE"
              label={copy.modeMobileLabel}
              selected={mode === 'MOBILE'}
              available={mobile.available}
              unavailableLabel={copy.modeUnavailableLabel}
              onSelect={() => setMode('MOBILE')}
            />
          </div>

          {mode === null ? (
            <p className="mt-3 text-[12px] font-semibold text-textMuted">
              {copy.chooseModeFirst}
            </p>
          ) : null}
        </section>

        {refusalMessage ? (
          <section
            data-testid="consult-proposal-refusal"
            data-refusal-code={answer?.reason ?? 'UNKNOWN'}
            aria-labelledby={`${consultId}-refusal`}
            className="rounded-2xl border border-toneWarn/30 bg-toneWarn/10 p-5"
          >
            <h2
              id={`${consultId}-refusal`}
              className="text-base font-black text-textPrimary"
            >
              {copy.refusalTitle}
            </h2>
            <p className="mt-2 text-sm leading-6 text-textSecondary">
              {refusalMessage}
            </p>
            <Link
              href={messageStartHref({ kind: 'PRO_PROFILE', professionalId })}
              className="mt-4 inline-flex items-center rounded-full border border-surfaceGlass/18 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass/6"
            >
              {copy.messageProCta}
            </Link>
          </section>
        ) : null}

        {proposal ? (
          <section
            data-testid="consult-proposal-summary"
            aria-labelledby={`${consultId}-proposal`}
            className="rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5"
          >
            <h2
              id={`${consultId}-proposal`}
              className="text-base font-black text-textPrimary"
            >
              {copy.proposalTitle}
            </h2>
            <p className="mt-1 text-sm text-textSecondary">
              {copy.proposalBody}
            </p>

            <ul className="mt-3 grid gap-2">
              {proposal.lines.map((line, index) => (
                <li
                  key={`${index}:${line.serviceName}`}
                  className="flex items-baseline justify-between gap-3 rounded-xl border border-surfaceGlass/10 bg-bgPrimary px-3 py-2.5"
                >
                  <span className="min-w-0 text-[13px] font-semibold text-textPrimary">
                    {line.serviceName}
                  </span>
                  <span className="shrink-0 text-[12px] font-semibold text-textMuted">
                    {formatDuration(line.durationMinutes)} ·{' '}
                    {formatRoundedDollars(line.price) ?? `$${line.price}`}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-semibold text-textSecondary">
                {copy.durationLabel}
              </span>
              <span className="font-black text-textPrimary">
                {formatDuration(proposal.totalDurationMinutes)}
              </span>
            </div>

            <div className="mt-3">
              <StartingAtBlock proposal={proposal} />
            </div>

            {/* Decision 4's client-facing half, composed by the server through
                the same fork the commit runs. */}
            <p
              data-testid="consult-proposal-commit-note"
              data-auto-accepts={proposal.autoAccepts ? 'true' : 'false'}
              className="mt-3 text-sm font-bold leading-6 text-textPrimary"
            >
              {proposal.commitNote}
            </p>

            <button
              type="button"
              data-testid="consult-proposal-choose-time"
              onClick={() => setDrawerOpen(true)}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-full border border-surfaceGlass/10 bg-accentPrimary text-[14px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
            >
              {copy.chooseTimeCta}
            </button>
          </section>
        ) : null}
      </div>

      {drawerContext ? (
        <AvailabilityDrawer
          open={drawerOpen}
          onClose={closeDrawer}
          context={drawerContext}
        />
      ) : null}
    </ClientPage>
  )
}
