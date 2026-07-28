// Client-facing payment options for a committed booking: the pro's accepted
// methods *with handles* (Venmo @, Zelle / Apple Cash / PayPal), plus the tip
// configuration and payment note. This is the gated, handle-carrying counterpart
// to publicAcceptedMethods.ts (which is deliberately handle-free for public
// profiles) — handles only ever surface to the client on their own committed
// booking.
//
// Single home for three things that used to live inline in the client booking
// page: (1) the Stripe-usable gate + handle/note trimming, (2) the accepted-method
// ordering + labels + handle mapping, and (3) the tip-suggestion normalization.
// The web booking page and the native client-bookings list DTO both build from
// here so the two never drift.
import { PaymentMethod, type Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'
import {
  buildClientSelfServePaymentMethods,
  paymentMethodKey,
  paymentMethodLabel,
} from '@/lib/payments/acceptedMethods'
import type {
  ClientBookingPaymentMethodDTO,
  ClientBookingPaymentOptionsDTO,
} from '@/lib/dto/clientBooking'

// Prisma select for everything the client payment options need: the accept*
// flags, the Stripe-usable gate inputs, the tip config, the off-platform handles,
// and the payment note. The list route selects this per booking's pro.
export const clientPaymentOptionsSelect = {
  collectPaymentAt: true,

  acceptCash: true,
  acceptCardOnFile: true,
  acceptTapToPay: true,
  acceptVenmo: true,
  acceptZelle: true,
  acceptAppleCash: true,
  acceptPaypal: true,
  acceptApplePay: true,

  // Stripe card is only client-usable when the connected account can actually
  // charge — gated below, never surfaced as the raw flag.
  acceptStripeCard: true,
  stripeAccountId: true, // pii-plaintext-read-ok: opaque Stripe account id, read only for the client-usable card gate
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,

  tipsEnabled: true,
  allowCustomTip: true,
  tipSuggestions: true,

  venmoHandle: true,
  zelleHandle: true,
  appleCashHandle: true,
  paypalHandle: true,
  paymentNote: true,
} satisfies Prisma.ProfessionalPaymentSettingsSelect

// The fields the Stripe-usable gate reads.
type StripeGateFields = {
  acceptStripeCard: boolean
  stripeAccountId: string | null
  stripeChargesEnabled: boolean
  stripePayoutsEnabled: boolean
}

// The per-method off-platform handles a client can be shown.
type MethodHandleFields = {
  venmoHandle: string | null
  zelleHandle: string | null
  appleCashHandle: string | null
  paypalHandle: string | null
}

// The off-platform handle + note fields that get trimmed to null when blank.
type HandleFields = MethodHandleFields & {
  paymentNote: string | null
}

// The accept* + handle fields the method list is built from. `acceptStripeCard`
// here is assumed already gated (see normalizeClientVisiblePaymentSettings).
type AcceptedMethodFields = {
  acceptCash: boolean
  acceptCardOnFile: boolean
  acceptTapToPay: boolean
  acceptVenmo: boolean
  acceptZelle: boolean
  acceptAppleCash: boolean
  acceptPaypal: boolean
  acceptApplePay: boolean
  acceptStripeCard: boolean
  venmoHandle: string | null
  zelleHandle: string | null
  appleCashHandle: string | null
  paypalHandle: string | null
}

function normalizeHandle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// Which stored handle (if any) a method surfaces to the client. Methods absent
// from this map are handle-free (cash / Stripe / the pro-run rails).
const HANDLE_FOR_METHOD: Partial<
  Record<PaymentMethod, (settings: MethodHandleFields) => string | null>
> = {
  [PaymentMethod.VENMO]: (s) => s.venmoHandle,
  [PaymentMethod.ZELLE]: (s) => s.zelleHandle,
  [PaymentMethod.APPLE_CASH]: (s) => s.appleCashHandle,
  [PaymentMethod.PAYPAL]: (s) => s.paypalHandle,
}

function canAcceptStripeCard(settings: StripeGateFields): boolean {
  return Boolean(
    settings.acceptStripeCard &&
      settings.stripeAccountId && // pii-plaintext-read-ok: opaque Stripe account id, read only for the card gate (never surfaced)
      settings.stripeChargesEnabled &&
      settings.stripePayoutsEnabled,
  )
}

/**
 * Gate Stripe to "actually chargeable" and trim the off-platform handles + note
 * to null when blank. Generic so callers keep their exact row type (the client
 * booking page's richer payload keeps its extra Stripe columns untouched).
 */
export function normalizeClientVisiblePaymentSettings<
  T extends StripeGateFields & HandleFields,
>(raw: T): T {
  return {
    ...raw,
    acceptStripeCard: canAcceptStripeCard(raw),
    venmoHandle: normalizeHandle(raw.venmoHandle),
    zelleHandle: normalizeHandle(raw.zelleHandle),
    appleCashHandle: normalizeHandle(raw.appleCashHandle),
    paypalHandle: normalizeHandle(raw.paypalHandle),
    paymentNote: normalizeHandle(raw.paymentNote),
  }
}

/**
 * The pro's accepted methods, in the canonical checkout display order, each with
 * its off-platform handle (null for on-platform / handle-free methods). Assumes
 * `acceptStripeCard` is already gated to "usable" (call
 * normalizeClientVisiblePaymentSettings first).
 */
export function buildClientAcceptedMethods(
  settings: AcceptedMethodFields | null,
): ClientBookingPaymentMethodDTO[] {
  // A pro with no saved settings still implicitly accepts cash (the schema
  // default), so a client is never hard-blocked from paying — mirror the web
  // page's fallback.
  if (!settings) {
    return [
      {
        key: paymentMethodKey(PaymentMethod.CASH),
        label: paymentMethodLabel(PaymentMethod.CASH),
        handle: null,
      },
    ]
  }

  // Built from the same set the client checkout route authorizes against, so a
  // method can never be OFFERED here yet rejected on confirm — the drift that
  // let a client pay a real PayPal transfer and then be unable to record it.
  // Pro-run rails (card on file / tap to pay / Apple Pay) are excluded: the
  // client can't execute those themselves, and confirming one used to stamp the
  // booking PAID with nothing charged.
  return [...buildClientSelfServePaymentMethods(settings)].map((method) => ({
    key: paymentMethodKey(method),
    label: paymentMethodLabel(method),
    handle: normalizeHandle(HANDLE_FOR_METHOD[method]?.(settings) ?? null),
  }))
}

/**
 * Normalize the stored tip suggestions into a list of whole-percent values.
 * The column stores `[{ label, percent }]`, but this also accepts a plain
 * numeric array (defensive) so a legacy shape can't blank the presets. Percents
 * are truncated, clamped to 0–100, and de-duplicated in order. Tip presets are
 * a services-subtotal percentage; the client prepends its own 0% option.
 */
export function normalizeTipSuggestionPercents(value: unknown): number[] {
  if (!Array.isArray(value)) return []

  const percents: number[] = []

  for (const item of value) {
    let raw: number

    if (typeof item === 'number') {
      raw = item
    } else if (typeof item === 'string') {
      raw = Number(item.trim())
    } else if (isRecord(item) && typeof item.percent === 'number') {
      raw = item.percent
    } else {
      continue
    }

    if (!Number.isFinite(raw)) continue

    const percent = Math.trunc(raw)
    if (percent < 0 || percent > 100) continue

    if (!percents.includes(percent)) percents.push(percent)
  }

  return percents
}

/**
 * Build the full client payment options block for a committed booking from a raw
 * ProfessionalPaymentSettings row (or null when the pro never saved settings).
 * Handles are gated to this path only. Returns null when there's nothing to pay
 * with (no row → the client checkout still offers Cash via buildClientAcceptedMethods,
 * so we return a Cash-only block rather than null to keep the client unblocked).
 */
export function buildClientPaymentOptions(
  raw:
    | (StripeGateFields &
        HandleFields &
        AcceptedMethodFields & {
          collectPaymentAt: string
          tipsEnabled: boolean
          allowCustomTip: boolean
          tipSuggestions: Prisma.JsonValue
        })
    | null,
): ClientBookingPaymentOptionsDTO {
  if (!raw) {
    return {
      methods: buildClientAcceptedMethods(null),
      tipsEnabled: true,
      allowCustomTip: true,
      tipSuggestions: [],
      paymentNote: null,
      collectPaymentAt: null,
    }
  }

  const settings = normalizeClientVisiblePaymentSettings(raw)

  return {
    methods: buildClientAcceptedMethods(settings),
    tipsEnabled: settings.tipsEnabled,
    allowCustomTip: settings.allowCustomTip,
    tipSuggestions: normalizeTipSuggestionPercents(settings.tipSuggestions),
    paymentNote: settings.paymentNote,
    collectPaymentAt:
      typeof settings.collectPaymentAt === 'string'
        ? settings.collectPaymentAt
        : null,
  }
}
