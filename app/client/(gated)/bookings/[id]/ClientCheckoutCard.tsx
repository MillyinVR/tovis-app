// app/client/bookings/[id]/ClientCheckoutCard.tsx 

'use client'

import { type MouseEvent, useMemo, useState, useTransition } from 'react'
import { formatMoneyFromUnknown } from '@/lib/money'
import { useRouter } from 'next/navigation'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import { buildPaymentDeepLink } from '@/lib/payments/paymentDeepLink'
import { useBrand } from '@/lib/brand/BrandProvider'
import { COPY } from '@/lib/copy'

type CheckoutStatus =
  | 'NOT_READY'
  | 'READY'
  | 'PARTIALLY_PAID'
  | 'AWAITING_CONFIRMATION'
  | 'PAID'
  | 'WAIVED'
  | string
  | null
  | undefined

type AcceptedMethod = {
  key: string
  label: string
  handle: string | null
}

/**
 * Where this card sends its writes. The gated booking page leaves it unset and
 * gets the authed booking routes; the PUBLIC aftercare page passes the
 * token-authenticated twins so an unclaimed client can use the very same
 * checkout UI. Parameterising the endpoints keeps one implementation of the
 * tip/method/deep-link logic instead of a second copy that drifts.
 */
export type ClientCheckoutEndpoints = {
  /** POST target for save-tip and off-platform confirm. */
  checkoutUrl: string
  /** POST target that mints a Stripe Checkout session. */
  stripeSessionUrl: string
  /** Idempotency scope + entity for both of the above. */
  idempotencyScope: string
  stripeIdempotencyScope: string
  idempotencyEntityId: string
}

type Props = {
  bookingId: string
  endpoints?: ClientCheckoutEndpoints
  checkoutStatus: CheckoutStatus
  paymentCollectedAt?: string | Date | null
  selectedPaymentMethod?: string | null

  serviceSubtotalSnapshot?: string | number | null
  productSubtotalSnapshot?: string | number | null
  tipAmount?: string | number | null
  taxAmount?: string | number | null
  discountAmount?: string | number | null
  totalAmount?: string | number | null
  /**
   * Deposit money already paid that comes off this bill, in CENTS. Derived
   * server-side by lib/booking/depositCredit.ts — the same helper the write
   * boundary charges from, so what the client is quoted here and what the
   * server collects cannot drift. 0 when no deposit applies.
   */
  depositCreditCents?: number | null

  acceptedMethods: AcceptedMethod[]

  tipsEnabled?: boolean | null
  allowCustomTip?: boolean | null
  tipSuggestions?: unknown

  // True when the pro also sent a rebook option (recommended window / coupled
  // next appointment). Flips the AWAITING_CONFIRMATION banner from "nothing else
  // to do" to rebook-guiding copy (PF6). Owned by the booking-detail page.
  rebookOptionAvailable?: boolean
}

const STRIPE_METHOD_KEY = 'stripe_card'

type SubmitResponse = {
  booking?: {
    id: string
    checkoutStatus?: string | null
    selectedPaymentMethod?: string | null
    serviceSubtotalSnapshot?: string | null
    productSubtotalSnapshot?: string | null
    subtotalSnapshot?: string | null
    tipAmount?: string | null
    taxAmount?: string | null
    discountAmount?: string | null
    totalAmount?: string | null
    paymentAuthorizedAt?: string | null
    paymentCollectedAt?: string | null
  }
  error?: string
  message?: string
}

type StripeSessionResponse = {
  stripeCheckout?: {
    url?: string | null
  } | null
  error?: string
  message?: string
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function getNumericMoney(value: unknown): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof value.toString === 'function'
  ) {
    const parsed = Number(String(value))
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}


function parseSubmitErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null

  if ('error' in data && typeof data.error === 'string' && data.error.trim()) {
    return data.error
  }

  if (
    'message' in data &&
    typeof data.message === 'string' &&
    data.message.trim()
  ) {
    return data.message
  }

  return null
}

// The UI key and the wire PaymentMethod differ only by case (see
// PAYMENT_METHOD_KEYS in lib/payments/acceptedMethods), so these are pure case
// transforms rather than hand-kept lists. The old enumerations silently dropped
// PAYPAL — the client could select PayPal, pay for real through the deep link,
// then get "Choose a payment method" forever because the request value came back
// null. Deriving can't go stale; the server still authorizes the method.
function normalizePaymentMethodKey(value: unknown): string {
  return upper(value).toLowerCase()
}

function methodKeyToRequestValue(value: string): string | null {
  const normalized = value.trim().toUpperCase()
  return normalized ? normalized : null
}

function normalizeTipSuggestionPercents(value: unknown): number[] {
  if (value === false) return []

  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => {
        if (typeof item === 'number') return item
        if (typeof item === 'string') {
          const numeric = Number(item.trim())
          return Number.isFinite(numeric) ? numeric : Number.NaN
        }
        return Number.NaN
      })
      .filter((item) => Number.isFinite(item))
      .map((item) => Math.round(item))
      .filter((item) => item >= 0 && item <= 100)

    const unique = Array.from(new Set(parsed))
    return unique
  }

  if (value === true || value == null) {
    return [15, 20, 25]
  }

  return [15, 20, 25]
}

function toTipAmountString(serviceSubtotal: number, percent: number): string {
  if (!Number.isFinite(serviceSubtotal) || serviceSubtotal <= 0) return '0.00'
  const amount = (serviceSubtotal * percent) / 100
  return amount.toFixed(2)
}

function moneyMatches(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}

/**
 * True on a phone/tablet, where a provider's custom URL scheme can actually
 * resolve to an installed app. Read at click time, never during render, so it
 * can't cause a hydration mismatch.
 */
function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

/**
 * Hand off to the provider's native app when there's an app-scheme URL and we're
 * on a phone. Custom schemes must be navigated from the user's own gesture in
 * the CURRENT tab — the https URL can't do it (Venmo only reaches the app via a
 * server redirect, which Safari won't follow out of a target=_blank tab), and a
 * new tab is exactly where iOS blocks scheme hand-offs. Desktop keeps the plain
 * https link, which opens the provider's web payment page.
 */
function handlePayLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  action: { appHref?: string },
): void {
  if (!action.appHref || !isMobileBrowser()) return

  event.preventDefault()
  window.location.href = action.appHref
}

/** The authed booking routes — used unless a caller passes its own endpoints. */
function defaultEndpoints(bookingId: string): ClientCheckoutEndpoints {
  const base = `/api/v1/client/bookings/${encodeURIComponent(bookingId)}/checkout`
  return {
    checkoutUrl: base,
    stripeSessionUrl: `${base}/stripe-session`,
    idempotencyScope: 'client-checkout',
    stripeIdempotencyScope: 'client-checkout-stripe-session',
    idempotencyEntityId: bookingId,
  }
}

async function submitCheckout(args: {
  endpoints: ClientCheckoutEndpoints
  tipAmount?: string | null
  selectedPaymentMethod?: string
  confirmPayment: boolean
}): Promise<SubmitResponse> {
  const idempotencyKey = buildClientIdempotencyKey({
    scope: args.endpoints.idempotencyScope,
    entityId: args.endpoints.idempotencyEntityId,
    action: args.confirmPayment ? 'confirm-payment' : 'save-checkout',
    // Save-tip is iterative (save 15%, change to 20%, save again). Those are
    // distinct bodies under one key, so without a nonce the second save in the
    // 60s bucket 409s on a body-hash conflict. Keying on tip+method lets a
    // changed save through while a true double-click still dedupes. The
    // terminal confirm-payment path is left strict (action-only key) so an
    // identical re-submit can never trigger a second charge.
    nonce: args.confirmPayment
      ? undefined
      : `${args.tipAmount ?? ''}|${args.selectedPaymentMethod ?? ''}`,
  })

  const response = await fetch(args.endpoints.checkoutUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...idempotencyHeaders(idempotencyKey),
    },
    body: JSON.stringify({
      tipAmount: args.tipAmount,
      selectedPaymentMethod: args.selectedPaymentMethod,
      confirmPayment: args.confirmPayment,
    }),
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    throw new Error(
      parseSubmitErrorMessage(data) || 'Could not update booking checkout.',
    )
  }

  return (data ?? {}) as SubmitResponse
}

async function createStripeCheckoutSession(args: {
  endpoints: ClientCheckoutEndpoints
  tipAmount: string
}): Promise<StripeSessionResponse> {
  const idempotencyKey = buildClientIdempotencyKey({
    scope: args.endpoints.stripeIdempotencyScope,
    entityId: args.endpoints.idempotencyEntityId,
    action: 'create-stripe-session',
    // Re-initiating with a changed tip (e.g. after returning from Stripe)
    // is a distinct body under one key; nonce on the tip avoids a 409 while
    // an identical re-initiate still dedupes.
    nonce: args.tipAmount,
  })

  const response = await fetch(args.endpoints.stripeSessionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...idempotencyHeaders(idempotencyKey),
    },
    body: JSON.stringify({
      tipAmount: args.tipAmount,
    }),
  })

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    throw new Error(
      parseSubmitErrorMessage(data) ||
        'Could not start secure card checkout.',
    )
  }

  return (data ?? {}) as StripeSessionResponse
}

function SummaryRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-textPrimary/10 py-2 last:border-b-0 last:pb-0 first:pt-0">
      <div className="text-[12px] font-black text-textSecondary">
        {props.label}
      </div>
      <div className="text-right text-[13px] font-semibold text-textPrimary">
        {props.value}
      </div>
    </div>
  )
}

// Tap-to-copy pill for methods (Zelle / Apple Cash) that can't be deep-linked
// with a pre-filled amount — the client copies the handle + amount into their
// bank app or Messages.
function CopyChip(props: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard
      ?.writeText(props.value)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        // Clipboard can be unavailable (insecure context / denied permission);
        // the value is still visible in the label, so fail silently.
      })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-full border border-textPrimary/10 bg-bgPrimary px-3 py-1.5 text-[12px] font-black text-textPrimary"
    >
      <span>{props.label}</span>
      <span className="text-[11px] font-black text-textSecondary">
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  )
}

export default function ClientCheckoutCard(props: Props) {
  const router = useRouter()
  const { brand } = useBrand()

  // Public aftercare passes token-authenticated twins; the gated page uses the
  // authed booking routes.
  const endpoints = useMemo(
    () => props.endpoints ?? defaultEndpoints(props.bookingId),
    [props.endpoints, props.bookingId],
  )

  const [selectedMethodKey, setSelectedMethodKey] = useState<string>(() =>
    normalizePaymentMethodKey(props.selectedPaymentMethod),
  )

  const [tipInput, setTipInput] = useState<string>(() => {
    const tip = getNumericMoney(props.tipAmount)
    return tip != null ? tip.toFixed(2) : '0.00'
  })

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const checkoutStatus = upper(props.checkoutStatus)
  const paymentCollected = Boolean(props.paymentCollectedAt)

  const checkoutLocked =
    paymentCollected ||
    checkoutStatus === 'PAID' ||
    checkoutStatus === 'WAIVED'

  // Off-platform payment the client already marked as sent — now waiting on the
  // pro to confirm receipt (PF1 AWAITING_CONFIRMATION). The client can't re-confirm
  // or edit the tip, so freeze the mutating controls, but keep the summary visible.
  const awaitingConfirmation = checkoutStatus === 'AWAITING_CONFIRMATION'
  const controlsFrozen = checkoutLocked || awaitingConfirmation

  // While waiting on the pro, point the client at rebooking when the pro sent a
  // rebook option — otherwise keep the "nothing else to do" reassurance (PF6).
  const awaitingBodyCopy =
    props.rebookOptionAvailable === true
      ? COPY.bookings.checkout.awaitingConfirmationBodyWithRebook
      : COPY.bookings.checkout.awaitingConfirmationBody

  const tipsEnabled = props.tipsEnabled !== false
  const allowCustomTip = props.allowCustomTip !== false

  const serviceSubtotal = useMemo(
    () => getNumericMoney(props.serviceSubtotalSnapshot) ?? 0,
    [props.serviceSubtotalSnapshot],
  )

  const configuredTipSuggestions = useMemo(
    () => normalizeTipSuggestionPercents(props.tipSuggestions),
    [props.tipSuggestions],
  )

  const productSubtotal = useMemo(
    () => getNumericMoney(props.productSubtotalSnapshot) ?? 0,
    [props.productSubtotalSnapshot],
  )

  const taxAmount = useMemo(
    () => getNumericMoney(props.taxAmount) ?? 0,
    [props.taxAmount],
  )

  const discountAmount = useMemo(
    () => getNumericMoney(props.discountAmount) ?? 0,
    [props.discountAmount],
  )

  const tipAmount = useMemo(() => {
    const trimmed = tipInput.trim()
    if (!trimmed) return 0
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
  }, [tipInput])

  const selectedMethod = useMemo(
    () =>
      props.acceptedMethods.find((method) => method.key === selectedMethodKey) ??
      null,
    [props.acceptedMethods, selectedMethodKey],
  )

  const selectedMethodIsStripe = selectedMethodKey === STRIPE_METHOD_KEY

  // Persisted server total (= service + product + saved tip + tax - discount),
  // frozen at the last save. It reflects the *saved* tip, not whatever the
  // client is currently typing, so it must never drive an on-screen or deep-link
  // amount — only the label decision below (finalized "Total" vs "Preview total")
  // and, at confirm time, the server's authoritative charge.
  const totalSnapshot = useMemo(
    () => getNumericMoney(props.totalAmount),
    [props.totalAmount],
  )
  // Live amount owed, recomputed client-side the instant the tip changes. This is
  // the single source of truth for every amount we show the client (Total row,
  // CTA, off-platform deep-link) so they all track the tip with no "Save tip"
  // round-trip. The charged amount is still settled server-side at confirm.
  const livePreviewTotal = useMemo(() => {
    return serviceSubtotal + productSubtotal + tipAmount + taxAmount - discountAmount
  }, [serviceSubtotal, productSubtotal, tipAmount, taxAmount, discountAmount])

  // A deposit the client already paid, in dollars. Server-derived (K10-A).
  const depositCredit = useMemo(
    () => Math.max(0, (props.depositCreditCents ?? 0) / 100),
    [props.depositCreditCents],
  )

  // 🔴 What the client actually still owes. Everything the client is shown or
  // handed — the Amount-due row, the CTA, and the pre-filled Venmo/Zelle
  // deep-link amount — reads THIS, never `livePreviewTotal`. Quoting the full
  // total on an off-platform hand-off would tell a client who already paid a
  // deposit to send it a second time, and there is no charge object to correct
  // it afterwards: they just send the money.
  const amountDue = useMemo(
    () => Math.max(0, livePreviewTotal - depositCredit),
    [livePreviewTotal, depositCredit],
  )
  const payAction = useMemo(
    () =>
      selectedMethod
        ? buildPaymentDeepLink({
            methodKey: selectedMethod.key,
            handle: selectedMethod.handle,
            amountDue,
            note: brand.displayName,
          })
        : null,
    [selectedMethod, amountDue, brand.displayName],
  )

  const presetPercents = useMemo(() => {
    if (!tipsEnabled || serviceSubtotal <= 0) return []

    const base =
      configuredTipSuggestions.length > 0
        ? configuredTipSuggestions
        : [15, 20, 25]

    return Array.from(new Set([0, ...base]))
  }, [configuredTipSuggestions, serviceSubtotal, tipsEnabled])

  const ctaDisabled =
    controlsFrozen ||
    isPending ||
    props.acceptedMethods.length === 0 ||
    !selectedMethod

  function selectPreset(percent: number) {
    setError(null)
    setSuccess(null)
    setTipInput(toTipAmountString(serviceSubtotal, percent))
  }

  function onTipInputChange(raw: string) {
    setError(null)
    setSuccess(null)

    const cleaned = raw.replace(/[^0-9.]/g, '')
    const parts = cleaned.split('.')

    if (parts.length > 2) return

    if (parts.length === 2) {
      setTipInput(`${parts[0] ?? ''}.${parts[1]?.slice(0, 2) ?? ''}`)
      return
    }

    setTipInput(parts[0] ?? '')
  }

  function handleMethodSelect(nextKey: string) {
    setError(null)
    setSuccess(null)
    setSelectedMethodKey(nextKey)
  }

  function handlePrimaryCta() {
    if (ctaDisabled) return

    setError(null)
    setSuccess(null)

    const requestMethod = methodKeyToRequestValue(selectedMethodKey)

    if (!requestMethod) {
      setError('Choose a payment method before continuing.')
      return
    }

    if (!tipsEnabled && tipAmount > 0) {
      setError('Tips are not enabled for this provider.')
      return
    }

    startTransition(() => {
      if (selectedMethodIsStripe) {
        void createStripeCheckoutSession({
          endpoints,
          tipAmount: tipAmount.toFixed(2),
        })
          .then((data) => {
            const checkoutUrl = data.stripeCheckout?.url?.trim()

            if (!checkoutUrl) {
              throw new Error('Stripe checkout did not return a payment link.')
            }

            window.location.assign(checkoutUrl)
          })
          .catch((submitError: unknown) => {
            const message =
              submitError instanceof Error && submitError.message.trim()
                ? submitError.message
                : 'Could not start secure card checkout.'
            setError(message)
          })

        return
      }

      void submitCheckout({
        endpoints,
        tipAmount: tipAmount.toFixed(2),
        selectedPaymentMethod: requestMethod,
        confirmPayment: true,
      })
        .then(() => {
          setSuccess('Payment confirmed.')
          router.refresh()
        })
        .catch((submitError: unknown) => {
          const message =
            submitError instanceof Error && submitError.message.trim()
              ? submitError.message
              : 'Could not update booking checkout.'
          setError(message)
        })
    })
  }

  function handleSaveTip() {
    if (controlsFrozen || isPending) return

    setError(null)
    setSuccess(null)

    if (!tipsEnabled && tipAmount > 0) {
      setError('Tips are not enabled for this provider.')
      return
    }

    const requestMethod = methodKeyToRequestValue(selectedMethodKey)

    startTransition(() => {
      void submitCheckout({
        endpoints,
        tipAmount: tipAmount.toFixed(2),
        // Only forward a method if the user chose a non-Stripe method.
        // Manual checkout endpoint rejects STRIPE_CARD on the confirm path,
        // and we don't want save-tip to touch the method otherwise.
        selectedPaymentMethod:
          requestMethod && requestMethod !== 'STRIPE_CARD'
            ? requestMethod
            : undefined,
        confirmPayment: false,
      })
        .then(() => {
          setSuccess('Tip saved.')
          router.refresh()
        })
        .catch((submitError: unknown) => {
          const message =
            submitError instanceof Error && submitError.message.trim()
              ? submitError.message
              : 'Could not update booking checkout.'
          setError(message)
        })
    })
  }

  const ctaLabel = (() => {
    if (isPending) {
      return selectedMethodIsStripe ? 'Opening Stripe…' : 'Confirming…'
    }
    if (!selectedMethod) return 'Choose a payment method'
    // The amount still owed, not the bill — a client with a deposit on this
    // booking must never be asked to "Pay $200" for a $140 balance.
    const due = formatMoneyFromUnknown(amountDue)
    if (selectedMethodIsStripe) {
      return due ? `Pay ${due} with card` : 'Pay with card'
    }
    return due ? `Confirm payment of ${due}` : 'Confirm payment'
  })()

  return (
    <div className="grid gap-4">
      <div className="rounded-card border border-textPrimary/10 bg-bgPrimary p-3">
        <div className="text-[12px] font-black text-textPrimary">
          Client checkout
        </div>

        <div className="mt-1 text-[12px] font-semibold text-textSecondary">
          Keep everything tied to this booking. Tip is calculated on services
          only.
        </div>

        {checkoutLocked ? (
          <div className="mt-2 text-[12px] font-semibold text-textSecondary">
            This checkout is already closed and can no longer be edited.
          </div>
        ) : null}

        {awaitingConfirmation ? (
          <div
            role="status"
            className="mt-3 rounded-card border border-accentPrimary/30 bg-accentPrimary/10 p-3"
          >
            <div className="text-[12px] font-black text-textPrimary">
              {COPY.bookings.checkout.awaitingConfirmationTitle}
            </div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              {awaitingBodyCopy}
            </div>
          </div>
        ) : null}

        <div className="mt-3 grid gap-1">
          <SummaryRow
            label="Services subtotal"
            value={formatMoneyFromUnknown(serviceSubtotal) || '$0.00'}
          />
          <SummaryRow
            label="Products subtotal"
            value={formatMoneyFromUnknown(productSubtotal) || '$0.00'}
          />
          {discountAmount > 0 ? (
            <SummaryRow
              label="Discount"
              value={formatMoneyFromUnknown(discountAmount) || '$0.00'}
            />
          ) : null}
          {taxAmount > 0 ? (
            <SummaryRow
              label="Tax"
              value={formatMoneyFromUnknown(taxAmount) || '$0.00'}
            />
          ) : null}
          <SummaryRow
            label="Tip"
            value={formatMoneyFromUnknown(tipAmount) || '$0.00'}
          />
          <SummaryRow
            label={totalSnapshot != null ? 'Total' : 'Preview total'}
            value={formatMoneyFromUnknown(livePreviewTotal) || '$0.00'}
          />
          {depositCredit > 0 ? (
            <>
              <SummaryRow
                label="Deposit already paid"
                value={`−${formatMoneyFromUnknown(depositCredit) || '$0.00'}`}
              />
              <SummaryRow
                label="Amount due"
                value={formatMoneyFromUnknown(amountDue) || '$0.00'}
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-card border border-textPrimary/10 bg-bgPrimary p-3">
        <div className="text-[12px] font-black text-textPrimary">Tip</div>

        {tipsEnabled ? (
          <>
            {presetPercents.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {presetPercents.map((percent) => {
                  const presetAmount = Number(
                    toTipAmountString(serviceSubtotal, percent),
                  )
                  const active = moneyMatches(tipAmount, presetAmount)

                  return (
                    <button
                      key={percent}
                      type="button"
                      onClick={() => selectPreset(percent)}
                      disabled={controlsFrozen || isPending}
                      className={[
                        'inline-flex items-center rounded-full border px-4 py-2 text-[12px] font-black disabled:cursor-not-allowed disabled:opacity-50',
                        active
                          ? 'border-textPrimary/10 bg-accentPrimary text-bgPrimary'
                          : 'border-textPrimary/10 bg-bgSecondary text-textPrimary',
                      ].join(' ')}
                    >
                      {percent}% ·{' '}
                      {formatMoneyFromUnknown(presetAmount) || '$0.00'}
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div className="mt-3">
              <label className="block text-[11px] font-black text-textSecondary">
                Custom tip amount
              </label>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[14px] font-black text-textPrimary">
                  $
                </span>
                <input
                  inputMode="decimal"
                  value={tipInput}
                  onChange={(event) => onTipInputChange(event.target.value)}
                  disabled={controlsFrozen || isPending || !allowCustomTip}
                  placeholder="0.00"
                  className="h-10 w-28 rounded-full border border-textPrimary/10 bg-bgSecondary px-4 text-[13px] font-black text-textPrimary outline-none placeholder:text-textSecondary disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Custom tip amount"
                />
              </div>

              <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                Tip uses the services subtotal only. Products do not affect tip.
              </div>

              {!allowCustomTip ? (
                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  Custom tip entry is turned off for this provider.
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="mt-2 text-[12px] font-semibold text-textSecondary">
            Tips are not enabled for this provider.
          </div>
        )}
      </div>

      <div className="rounded-card border border-textPrimary/10 bg-bgPrimary p-3">
        <div className="text-[12px] font-black text-textPrimary">
          Payment method
        </div>

        {props.acceptedMethods.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {props.acceptedMethods.map((method) => {
              const active = method.key === selectedMethodKey

              return (
                <button
                  key={method.key}
                  type="button"
                  onClick={() => handleMethodSelect(method.key)}
                  disabled={controlsFrozen || isPending}
                  className={[
                    'flex w-full items-start justify-between gap-3 rounded-card border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50',
                    active
                      ? 'border-textPrimary/10 bg-accentPrimary text-bgPrimary'
                      : 'border-textPrimary/10 bg-bgSecondary text-textPrimary',
                  ].join(' ')}
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-black">{method.label}</div>
                    {method.handle ? (
                      <div
                        className={[
                          'mt-1 text-[12px] font-semibold',
                          active ? 'text-bgPrimary/80' : 'text-textSecondary',
                        ].join(' ')}
                      >
                        {method.handle}
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-[11px] font-black">
                    {active ? 'Selected' : 'Choose'}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="mt-2 text-[12px] font-semibold text-textSecondary">
            No payment methods are enabled yet for this provider.
          </div>
        )}
      </div>

      <div className="rounded-card border border-textPrimary/10 bg-bgPrimary p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[12px] font-black text-textPrimary">
              {awaitingConfirmation
                ? COPY.bookings.checkout.awaitingConfirmationTitle
                : selectedMethodIsStripe
                  ? 'Pay securely with card'
                  : 'Confirm payment'}
            </div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              {awaitingConfirmation
                ? awaitingBodyCopy
                : selectedMethodIsStripe
                  ? 'Card payment opens Stripe Checkout. Tips are saved before redirect.'
                  : 'Once your pro confirms they received payment, your booking will close out.'}
            </div>
          </div>

          {awaitingConfirmation ? null : (
            <div className="flex flex-wrap gap-2">
              {tipsEnabled ? (
                <button
                  type="button"
                  onClick={handleSaveTip}
                  disabled={controlsFrozen || isPending}
                  className="inline-flex items-center justify-center rounded-full border border-textPrimary/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Save tip without confirming payment"
                >
                  {isPending ? 'Saving…' : 'Save tip'}
                </button>
              ) : null}

              <button
                type="button"
                onClick={handlePrimaryCta}
                disabled={ctaDisabled}
                className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {ctaLabel}
              </button>
            </div>
          )}
        </div>

        {selectedMethod && !awaitingConfirmation ? (
          <div className="mt-3 text-[12px] font-semibold text-textSecondary">
            Paying with {selectedMethod.label}.
          </div>
        ) : null}

        {payAction && !awaitingConfirmation ? (
          <div className="mt-3">
            {payAction.kind === 'link' ? (
              <>
                <a
                  href={payAction.href}
                  onClick={(event) => handlePayLinkClick(event, payAction)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center rounded-full border border-accentPrimary bg-accentPrimary/10 px-4 py-2 text-[12px] font-black text-accentPrimary sm:w-auto"
                >
                  {payAction.label}
                </a>
                <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                  Opens {selectedMethod?.label} with the amount filled in. After
                  you send it, tap “{ctaLabel}” to close out this booking.
                </div>
              </>
            ) : (
              <div className="rounded-card border border-textPrimary/10 bg-bgSecondary p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CopyChip label={`Send to ${payAction.handle}`} value={payAction.handle} />
                  <CopyChip label={`Amount $${payAction.amount}`} value={payAction.amount} />
                </div>
                <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                  {payAction.instruction} Then tap “{ctaLabel}” to close out this
                  booking.
                </div>
              </div>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 text-[12px] font-semibold text-toneDanger">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mt-3 text-[12px] font-semibold text-textPrimary">
            {success}
          </div>
        ) : null}
      </div>
    </div>
  )
}