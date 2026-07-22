// app/pro/calendar/_components/WaitlistOfferModal.tsx
'use client'

import { useEffect, useState } from 'react'

import RebookSlotPicker, {
  type SelectedRebookSlot,
} from '@/app/pro/bookings/[id]/aftercare/RebookSlotPicker'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { ymdInTimeZone } from '@/lib/time'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'

type Props = {
  open: boolean
  onClose: () => void
  /** The authed pro (for the availability query the picker runs). */
  professionalId: string
  waitlistEntryId: string
  serviceId: string
  /** null when the pro has no active offering for the service — offering blocked. */
  offeringId: string | null
  /** In-salon location the offer is anchored to. */
  locationId: string
  timeZone: string
  clientName: string
  serviceName: string
  /** Called after a successful offer so the caller can reload the calendar. */
  onOffered: () => void
}

function errorFrom(res: Response, data: unknown): string {
  if (isRecord(data) && typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim()
  }
  if (res.status === 409) {
    return 'That time is no longer available. Pick another.'
  }
  return 'Could not send the offer. Please try again.'
}

export default function WaitlistOfferModal({
  open,
  onClose,
  professionalId,
  waitlistEntryId,
  serviceId,
  offeringId,
  locationId,
  timeZone,
  clientName,
  serviceName,
  onOffered,
}: Props) {
  const [slot, setSlot] = useState<SelectedRebookSlot | null>(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Reset transient state whenever the modal opens for a new entry.
  useEffect(() => {
    if (open) {
      setSlot(null)
      setErr(null)
      setSending(false)
    }
  }, [open, waitlistEntryId])

  if (!open) return null

  const minYmd = ymdInTimeZone(new Date(), timeZone)
  const canOffer = Boolean(offeringId)

  async function send() {
    if (!slot || sending) return
    setErr(null)
    setSending(true)

    try {
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'pro-waitlist-offer',
        entityId: waitlistEntryId,
        action: slot.startsAt,
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
            locationId,
            locationType: 'SALON',
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
      if (!res.ok) throw new Error(errorFrom(res, data))

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
          {canOffer && offeringId ? (
            <RebookSlotPicker
              professionalId={professionalId}
              serviceId={serviceId}
              offeringId={offeringId}
              locationType="SALON"
              locationId={locationId}
              clientAddressId={null}
              timeZone={timeZone}
              minYmd={minYmd}
              value={slot}
              disabled={sending}
              onChange={setSlot}
            />
          ) : (
            <p className="text-[13px] text-textSecondary">
              You don&rsquo;t have an active in-salon offering for this service, so
              there&rsquo;s no time to offer yet. Add or activate the service first.
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
