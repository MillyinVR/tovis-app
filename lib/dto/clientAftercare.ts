// lib/dto/clientAftercare.ts
//
// Wire contract for GET /api/v1/client/bookings/[id]/aftercare — the client's
// read of their own aftercare: care notes (only once the pro has SENT the
// summary) plus the primary before/after pair the pro featured. Powers the
// native client aftercare render (iOS BookingDetailView), matching the web
// booking-detail aftercare tab. The web page renders this in a server component;
// this endpoint exposes the same data to non-web clients.
//
// The before/after pair is the shared SSOT `BookingBeforeAfterThumbs`
// (pro-chosen featured pair, else earliest-per-phase) — the same shape the
// client home aftercare action card already carries.

import { isClientAftercareVisible } from '@/lib/aftercare/aftercareVisibility'
import type { BookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'

/** The care-notes slice of a SENT aftercare summary the client may read. */
export type ClientAftercareSummaryDTO = {
  id: string
  /** Free-text care instructions the pro wrote for the client. */
  notes: string | null
  /** ISO instant the pro sent this aftercare to the client. */
  sentToClientAt: string | null
}

export type ClientAftercareDetailDTO = {
  /**
   * Whether the client's aftercare surface is visible for this booking —
   * mirrors the web `canShowAftercareTab` gate (booking COMPLETED, or a sent
   * aftercare summary exists). When false the native client hides the section.
   */
  canShowAftercare: boolean
  /** The sent aftercare summary (care notes), or null when none is sent yet. */
  aftercare: ClientAftercareSummaryDTO | null
  /** Primary before/after pair (featured, else earliest per phase). */
  beforeAfter: BookingBeforeAfterThumbs
}

/**
 * Build the client aftercare read DTO. `status` is the booking's lifecycle
 * status; `aftercare` is the SENT summary (already filtered to
 * `sentToClientAt != null`) or null; `beforeAfter` is the resolved pair.
 */
export function buildClientAftercareDetailDTO(input: {
  status: string | null
  aftercare: { id: string; notes: string | null; sentToClientAt: Date | null } | null
  beforeAfter: BookingBeforeAfterThumbs
}): ClientAftercareDetailDTO {
  const aftercare = input.aftercare
    ? {
        id: input.aftercare.id,
        notes: input.aftercare.notes,
        sentToClientAt: input.aftercare.sentToClientAt?.toISOString() ?? null,
      }
    : null

  return {
    canShowAftercare: isClientAftercareVisible({
      status: input.status,
      hasSentAftercare: Boolean(aftercare),
    }),
    aftercare,
    beforeAfter: input.beforeAfter,
  }
}
