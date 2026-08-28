// app/pro/calendar/_components/WaitlistOfferModal.tsx
//
// "Offer a time" for a waitlisted client — in-salon OR mobile.
//
// The mode list is NOT decided here. This used to send `locationType: 'SALON'`
// as a literal and be rendered only when the calendar had found a bookable salon
// location, so a mobile-only pro had no offer action at all and no way to learn
// why. It now asks the server what it may offer
// (`GET /api/v1/pro/waitlist/{entryId}/offer`), which answers from the same two
// resolvers the POST re-runs under the professional's lock — so every option
// shown is one the send will accept.
//
// 🔴 Nothing about the client's address is in this component, and nothing about
// it arrives in any response it reads. A mobile option carries the pro's own
// base; the destination is resolved server-side, from the waitlist entry, both
// for the availability query (`waitlistEntryId`, not `clientAddressId`) and for
// the offer itself. The pro learns how far and roughly where only once the offer
// exists, and the exact address only once the client accepts it.
'use client'

import { useCallback, useEffect, useState } from 'react'

import RebookSlotPicker, {
  type SelectedRebookSlot,
} from '@/app/pro/bookings/[id]/aftercare/RebookSlotPicker'
import { errorFromResponse, safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { ymdInTimeZone } from '@/lib/time'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'

/** One mode the server says this pro may offer this entry a time in. */
type OfferOption = {
  locationType: 'SALON' | 'MOBILE'
  locationId: string
  locationName: string | null
  timeZone: string
  durationMinutes: number
}

type Props = {
  open: boolean
  onClose: () => void
  /** The authed pro (for the availability query the picker runs). */
  professionalId: string
  waitlistEntryId: string
  serviceId: string
  /** Zone to fall back to before the server's options land. */
  fallbackTimeZone: string
  clientName: string
  serviceName: string
  /** Called after a successful offer so the caller can reload the calendar. */
  onOffered: () => void
}

function parseOfferOptions(data: unknown): {
  offeringId: string | null
  options: OfferOption[]
  blockedReason: string | null
} {
  if (!isRecord(data)) {
    return { offeringId: null, options: [], blockedReason: null }
  }

  const rawOptions = Array.isArray(data.options) ? data.options : []
  const options: OfferOption[] = []

  for (const raw of rawOptions) {
    if (!isRecord(raw)) continue
    if (raw.locationType !== 'SALON' && raw.locationType !== 'MOBILE') continue
    if (typeof raw.locationId !== 'string' || !raw.locationId) continue
    if (typeof raw.timeZone !== 'string' || !raw.timeZone) continue
    if (typeof raw.durationMinutes !== 'number' || raw.durationMinutes <= 0) {
      continue
    }

    options.push({
      locationType: raw.locationType,
      locationId: raw.locationId,
      locationName:
        typeof raw.locationName === 'string' ? raw.locationName : null,
      timeZone: raw.timeZone,
      durationMinutes: raw.durationMinutes,
    })
  }

  return {
    offeringId: typeof data.offeringId === 'string' ? data.offeringId : null,
    options,
    blockedReason:
      typeof data.blockedReason === 'string' ? data.blockedReason : null,
  }
}

function modeLabel(option: OfferOption): string {
  if (option.locationType === 'MOBILE') return 'Mobile'
  return option.locationName?.trim() || 'In-salon'
}

export default function WaitlistOfferModal({
  open,
  onClose,
  professionalId,
  waitlistEntryId,
  serviceId,
  fallbackTimeZone,
  clientName,
  serviceName,
  onOffered,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [offeringId, setOfferingId] = useState<string | null>(null)
  const [options, setOptions] = useState<OfferOption[]>([])
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [modeIndex, setModeIndex] = useState(0)
  const [slot, setSlot] = useState<SelectedRebookSlot | null>(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadOptions = useCallback(async () => {
    setLoading(true)
    setErr(null)

    try {
      const res = await fetch(
        `/api/v1/pro/waitlist/${encodeURIComponent(waitlistEntryId)}/offer`,
      )
      const data = await safeJson(res)

      if (!res.ok) {
        throw new Error(
          errorFromResponse(res, data, {
            fallback: 'Could not load what you can offer. Please try again.',
          }),
        )
      }

      const parsed = parseOfferOptions(data)
      setOfferingId(parsed.offeringId)
      setOptions(parsed.options)
      setBlockedReason(parsed.blockedReason)
      setModeIndex(0)
    } catch (error: unknown) {
      setOfferingId(null)
      setOptions([])
      setBlockedReason(null)
      setErr(
        error instanceof Error
          ? error.message
          : 'Could not load what you can offer. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }, [waitlistEntryId])

  // Reset transient state whenever the modal opens for a new entry, then ask
  // the server what this pro may offer.
  useEffect(() => {
    if (!open) return
    setSlot(null)
    setSending(false)
    void loadOptions()
  }, [open, loadOptions])

  if (!open) return null

  const selected = options[modeIndex] ?? null
  const timeZone = selected?.timeZone ?? fallbackTimeZone
  const minYmd = ymdInTimeZone(new Date(), timeZone)
  const canOffer = Boolean(offeringId && selected)

  async function send() {
    if (!slot || sending || !selected) return
    setErr(null)
    setSending(true)

    try {
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'pro-waitlist-offer',
        entityId: waitlistEntryId,
        // The mode is part of the key: offering the same minute in-salon and
        // mobile are two different promises, and a replay must not collapse them.
        action: `${selected.locationType}:${slot.startsAt}`,
      })

      const res = await fetch(
        `/api/v1/pro/waitlist/${encodeURIComponent(waitlistEntryId)}/offer`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(idempotencyKey),
          },
          body: JSON.stringify({
            scheduledFor: slot.startsAt,
            endsAt: slot.endsAt,
            locationId: selected.locationId,
            locationType: selected.locationType,
            durationMinutes: Math.max(
              15,
              Math.round(
                (new Date(slot.endsAt).getTime() -
                  new Date(slot.startsAt).getTime()) /
                  60_000,
              ),
            ),
          }),
        },
      )

      const data = await safeJson(res)
      if (!res.ok) {
        throw new Error(
          errorFromResponse(res, data, {
            byStatus: { 409: 'That time is no longer available. Pick another.' },
            fallback: 'Could not send the offer. Please try again.',
          }),
        )
      }

      onOffered()
      onClose()
    } catch (error: unknown) {
      setErr(
        error instanceof Error
          ? error.message
          : 'Could not send the offer. Please try again.',
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="brand-pro-calendar-block-overlay"
      onClick={() => {
        if (!sending) onClose()
      }}
    >
      <div
        className="brand-pro-calendar-block-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Offer a time"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="brand-pro-calendar-block-header">
          <div className="brand-pro-calendar-block-drag-handle" />

          <div className="brand-pro-calendar-block-header-row">
            <div className="brand-pro-calendar-block-header-copy">
              <p className="brand-pro-calendar-block-eyebrow">Waitlist</p>
              <h2 className="brand-pro-calendar-block-title">Offer a time</h2>
              <p className="brand-pro-calendar-block-description">
                Propose a time to {clientName || 'this client'} for {serviceName}.
                They&rsquo;ll confirm before it books, and the slot is held for
                them until they answer.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="brand-focus rounded-full border border-textPrimary/16 px-3 py-1 text-[12px] font-bold text-textSecondary transition hover:text-textPrimary disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </header>

        <div className="brand-pro-calendar-block-body">
          {loading ? (
            <p className="text-[13px] text-textSecondary">
              Loading what you can offer&hellip;
            </p>
          ) : canOffer && offeringId && selected ? (
            <>
              {options.length > 1 ? (
                <div
                  role="radiogroup"
                  aria-label="Where this appointment happens"
                  className="mb-3 flex flex-wrap gap-2"
                >
                  {options.map((option, index) => (
                    <button
                      key={`${option.locationType}:${option.locationId}`}
                      type="button"
                      role="radio"
                      aria-checked={index === modeIndex}
                      disabled={sending}
                      onClick={() => {
                        if (index === modeIndex) return
                        // A slot is only valid for the mode it was computed in.
                        setModeIndex(index)
                        setSlot(null)
                      }}
                      className={
                        index === modeIndex
                          ? 'brand-focus rounded-full border border-accent bg-accent/12 px-3 py-1 text-[12px] font-bold text-textPrimary disabled:opacity-50'
                          : 'brand-focus rounded-full border border-textPrimary/16 px-3 py-1 text-[12px] font-bold text-textSecondary transition hover:text-textPrimary disabled:opacity-50'
                      }
                    >
                      {modeLabel(option)}
                    </button>
                  ))}
                </div>
              ) : null}

              {selected.locationType === 'MOBILE' ? (
                <p className="mb-3 text-[12px] text-textMuted">
                  You&rsquo;ll travel to {clientName || 'this client'}. Once they
                  accept, their address appears on the booking.
                </p>
              ) : null}

              <RebookSlotPicker
                professionalId={professionalId}
                serviceId={serviceId}
                offeringId={offeringId}
                locationType={selected.locationType}
                locationId={selected.locationId}
                // Deliberately null on both paths: the mobile destination is
                // resolved server-side from `waitlistEntryId` below.
                clientAddressId={null}
                waitlistEntryId={waitlistEntryId}
                timeZone={timeZone}
                minYmd={minYmd}
                value={slot}
                disabled={sending}
                onChange={setSlot}
              />
            </>
          ) : (
            <p className="text-[13px] text-textSecondary">
              {blockedReason ??
                'There’s no time to offer for this service yet. Add or activate the service and a bookable location first.'}
            </p>
          )}

          {err ? (
            <p className="mt-3 text-[13px] font-semibold text-toneDanger">{err}</p>
          ) : null}
        </div>

        <footer className="brand-pro-calendar-block-footer">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="brand-focus rounded-full border border-textPrimary/16 px-4 py-2 text-[13px] font-bold text-textSecondary transition hover:text-textPrimary disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={send}
            disabled={!canOffer || !slot || sending}
            className="brand-button-primary brand-focus rounded-full px-5 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send offer'}
          </button>
        </footer>
      </div>
    </div>
  )
}
