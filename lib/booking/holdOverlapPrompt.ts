// lib/booking/holdOverlapPrompt.ts
//
// The pro's live-hold decision, on the wire and in words.
//
// B5 made a client's checkout an ANONYMOUS tile on the pro's calendar: the pro
// can see the minutes are spoken for, and nothing about who is holding them. A
// client mid-checkout has not agreed to be identified to a pro before they
// commit. That stays true here — this is the popup that appears when a pro
// tries to book over one of those tiles, and the ONLY thing it adds to the
// anonymity is whether the held client is new or returning TO THIS PRO (Tori,
// 2026-08-28, explicitly and only that).
//
// 🔴 `HeldSlotDecision` is the whole payload the server is allowed to send, and
// every field is a string, an enum or a count. There is deliberately no room in
// it for a name, an email, a phone, an avatar or a client id — a shared client
// DTO would have carried all five as a matter of course, which is why this is
// its own narrow type rather than a slice of one. Widening it is a product
// decision, not a refactor.
//
// Sibling of `lib/booking/overridePrompts.ts` — same job (turn a structured
// booking refusal into a confirm-and-retry), same shape, same reason its copy
// lives beside the parser: web and iOS both read this contract, and a second
// copy of the wording is how the two surfaces start saying different things.

import { isNonEmptyString, isRecord } from '@/lib/guards'

/**
 * The request field that carries the pro's answer back. A second attempt with
 * this `true` authorizes the overlap AND writes the audit-trail entry; without
 * it the server asks again.
 */
export const CONFIRM_HOLD_OVERLAP_FIELD = 'confirmHoldOverlap'

/** The error code the refusal-that-is-really-a-question comes back as. */
export const HOLD_OVERLAP_DECISION_CODE = 'HOLD_OVERLAP_NEEDS_CONFIRMATION'

/**
 * Whether the held client has booked with THIS pro before — the one fact the
 * popup is allowed to add to an otherwise anonymous hold.
 *
 * `UNKNOWN` is a first-class value, not an error: a hold can have no client at
 * all (`BookingHold.clientId` is nullable), and inventing "new" for one would
 * tell the pro something nobody checked.
 */
export type HeldSlotRelationship = 'NEW' | 'RETURNING' | 'UNKNOWN'

export const HELD_SLOT_RELATIONSHIPS: readonly HeldSlotRelationship[] = [
  'NEW',
  'RETURNING',
  'UNKNOWN',
]

/** Everything the server may say about the reservation in the way. */
export type HeldSlotDecision = {
  /** The hold's own id — an opaque key on the pro's own calendar, not the client's. */
  holdId: string
  relationship: HeldSlotRelationship
  /** The service being held, as the pro's own catalog names it. */
  serviceName: string
  /** ISO instants. The popup formats them in the booking's timezone. */
  startsAt: string
  endsAt: string
  /** When the reservation lapses — drives the same countdown the client sees. */
  expiresAt: string
  /**
   * How many FURTHER live holds this one attempt would also book over. Almost
   * always 0; a wide reschedule can span two. Reported so the popup never
   * implies a single client when the pro is about to overrule several.
   */
  additionalHeldSlots: number
}

/** Which action ran into the hold — only the wording differs. */
export type HoldOverlapPromptIntent = 'create' | 'edit'

export type HoldOverlapPromptCopy = {
  title: string
  /** Trails the service + time sentence, e.g. "A returning client is booking". */
  leadIn: string
  countdownSuffix: string
  countdownLapsedNote: string
  additionalHeldSlotsNote: (count: number) => string
  proceedLabel: string
  waitLabel: string
  anonymityNote: string
}

const RELATIONSHIP_LEAD_IN: Record<HeldSlotRelationship, string> = {
  NEW: 'A new client is booking',
  RETURNING: 'A returning client is booking',
  // Says only what is true. "A client" still tells the pro the time is
  // genuinely spoken for, which is the part that matters for the decision.
  UNKNOWN: 'A client is booking',
}

const HOLD_OVERLAP_PROMPT_COPY: Record<
  HoldOverlapPromptIntent,
  Omit<HoldOverlapPromptCopy, 'leadIn'>
> = {
  create: {
    title: 'Someone is checking out for this time',
    countdownSuffix: 'left to finish',
    countdownLapsedNote: 'Their checkout just ran out — this time is free again.',
    additionalHeldSlotsNote: (count) =>
      count === 1
        ? 'One more client is checking out inside this time too.'
        : `${count} more clients are checking out inside this time too.`,
    proceedLabel: 'Book it anyway',
    waitLabel: 'Wait for them',
    anonymityNote: 'We only say new or returning while a checkout is in progress.',
  },
  edit: {
    title: 'Someone is checking out for this time',
    countdownSuffix: 'left to finish',
    countdownLapsedNote: 'Their checkout just ran out — this time is free again.',
    additionalHeldSlotsNote: (count) =>
      count === 1
        ? 'One more client is checking out inside this time too.'
        : `${count} more clients are checking out inside this time too.`,
    proceedLabel: 'Move it here anyway',
    waitLabel: 'Wait for them',
    anonymityNote: 'We only say new or returning while a checkout is in progress.',
  },
}

export function holdOverlapPromptCopy(
  relationship: HeldSlotRelationship,
  intent: HoldOverlapPromptIntent,
): HoldOverlapPromptCopy {
  return {
    ...HOLD_OVERLAP_PROMPT_COPY[intent],
    leadIn: RELATIONSHIP_LEAD_IN[relationship],
  }
}

function isHeldSlotRelationship(value: unknown): value is HeldSlotRelationship {
  return (
    typeof value === 'string' &&
    (HELD_SLOT_RELATIONSHIPS as readonly string[]).includes(value)
  )
}

function isParsableInstant(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value))
}

/**
 * Normalize the decision payload off a failed booking response.
 *
 * Nothing is trusted as sent: an unknown relationship, an unparsable instant or
 * a missing service name yields `null` and the caller falls back to its ordinary
 * error path. A popup that renders half a fact — "A client is booking  for " —
 * is worse than the plain refusal it replaced.
 */
export function parseHeldSlotDecision(value: unknown): HeldSlotDecision | null {
  if (!isRecord(value)) return null

  const {
    holdId,
    relationship,
    serviceName,
    startsAt,
    endsAt,
    expiresAt,
    additionalHeldSlots,
  } = value

  if (!isNonEmptyString(holdId)) return null
  if (!isHeldSlotRelationship(relationship)) return null
  if (!isNonEmptyString(serviceName)) return null
  if (!isParsableInstant(startsAt)) return null
  if (!isParsableInstant(endsAt)) return null
  if (!isParsableInstant(expiresAt)) return null

  return {
    holdId,
    relationship,
    serviceName,
    startsAt,
    endsAt,
    expiresAt,
    additionalHeldSlots:
      typeof additionalHeldSlots === 'number' &&
      Number.isFinite(additionalHeldSlots) &&
      additionalHeldSlots > 0
        ? Math.floor(additionalHeldSlots)
        : 0,
  }
}

/**
 * Reads the live-hold decision off a failed booking API response body
 * (`jsonFail` puts `code` and the extras at the top level), and returns it only
 * when the failure really is the decision — mirroring
 * `readBookingOverridePrompt`.
 */
export function readHoldOverlapDecision(data: unknown): HeldSlotDecision | null {
  if (!isRecord(data)) return null
  if (data.code !== HOLD_OVERLAP_DECISION_CODE) return null

  return parseHeldSlotDecision(data.heldSlot)
}

/**
 * Thrown by booking PATCH helpers when the failure is the live-hold decision,
 * so callers can put the choice in front of the pro instead of dead-ending.
 *
 * Deliberately the same shape as `BookingOverrideRequiredError` — the calendar
 * already knows how to catch one of those, keep its optimistic event in place
 * and retry with a flag, and this rides that machinery rather than inventing a
 * second one beside it.
 */
export class HoldOverlapDecisionRequiredError extends Error {
  readonly decision: HeldSlotDecision

  constructor(message: string, decision: HeldSlotDecision) {
    super(message)
    this.name = 'HoldOverlapDecisionRequiredError'
    this.decision = decision
  }
}
