// The per-booking session-state wire contract —
// GET /api/v1/pro/bookings/{id}/session/state.
//
// K17-A. #812 put K15's unsigned-form list on `GET /api/v1/pro/session`, the
// FOOTER payload, because that is the route whose `SessionBooking` shape the
// native footer already decodes. But the surface that renders the warning is the
// session HUB, and the hub is a per-booking screen: web's session page loads its
// own copy in the page loader (`loadUnsignedConsentFormsForBookings`), and the
// native hub loads THIS route as its spine. So the footer payload could not
// reach it — a pro who opens a booking's session from the booking detail rather
// than from the footer button is looking at a booking the footer payload may not
// even mention ([[a-timestamp-column-with-no-writer]]: the field existed, the
// path to the screen did not).
//
// 🔴 `unsignedConsentForms` is a SIBLING of `state`, deliberately not part of it.
// `state` is `buildProSessionState`'s pure output over one booking row and is
// HASHED for polling; the consent list is neither a booking-row fact nor free to
// compute (two extra queries), so folding it in would put a DB round trip on
// every poll tick and refresh web's whole server-rendered page whenever a
// signature lands. The banner is a warning the pro acts on, not a live counter —
// it refreshes when the screen reloads.
//
// 🔴 The list is UNGATED by design — do not reach for anything shaped like
// `significant`. At session start the appointment's scheduled time has arrived,
// which is exactly the condition the calendar badge's significance gate uses to
// go quiet. See the note above `loadUnsignedConsentFormsForBookings`.

import type { UnsignedConsentForm } from '@/lib/consentForms/requirement'
import type { ProSessionState } from '@/lib/proSession/sessionState'

/** One consent form this appointment needs and this client has not signed. */
export type ProSessionUnsignedConsentFormDTO = UnsignedConsentForm

export type ProSessionStateResponseDTO = {
  /** The hashable snapshot — unchanged by K17-A. */
  state: ProSessionState
  /** sha256 of `state`, and of `state` alone. */
  stateHash: string
  /**
   * Forms outstanding for THIS booking, omitted entirely when there are none or
   * when the technical-record gate is off — so a pro who has bound no form gets
   * a payload byte-identical to pre-K17-A.
   *
   * Declared HERE rather than added at the route, because a field the route adds
   * with a conditional spread never reaches `gen:api-schema` and crosses to the
   * device with zero contract coverage — which is exactly how K15's calendar
   * mark shipped uncovered (#812's first finding).
   */
  unsignedConsentForms?: ProSessionUnsignedConsentFormDTO[]
}
