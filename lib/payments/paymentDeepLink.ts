// Turn a pro's off-platform payment handle + the amount due into a one-tap pay
// action for the client checkout.
//
// Two shapes come out of this, because not every payment app exposes a public
// deep link:
//
//   • 'link'  — Venmo / PayPal expose a URL that opens their app (or web) with
//               the recipient and amount pre-filled. The client taps it, the
//               app opens ready to send, they confirm in-app.
//   • 'copy'  — Zelle / Apple Cash have NO public deep link: they live inside
//               the client's own bank app / Messages, with no URL that can
//               pre-fill recipient + amount. The best we can do is surface the
//               handle and amount to copy, plus a short instruction.
//
// Cash, card-on-file, tap-to-pay and Stripe card have no off-platform action
// here (cash is in person; the rest go through Stripe) → this returns null.

export type PaymentDeepLink =
  | {
      kind: 'link'
      /** App/universal URL that opens the payment pre-filled. */
      href: string
      /** Human label for the button, e.g. "Pay $80.00 with Venmo". */
      label: string
    }
  | {
      kind: 'copy'
      /** The pro's handle (Venmo @, Zelle/Apple Cash phone or email). */
      handle: string
      /** Amount to send, formatted "80.00". */
      amount: string
      /** One-line instruction, e.g. "Open Zelle in your bank app…". */
      instruction: string
    }

function normalizeAmount(amountDue: number): string | null {
  if (!Number.isFinite(amountDue) || amountDue <= 0) return null
  return amountDue.toFixed(2)
}

/** Strip a leading "@" and surrounding whitespace from a handle. */
function cleanHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').trim()
}

/**
 * Pull the username out of whatever the pro saved for PayPal: a bare username,
 * "@username", "paypal.me/username", or a full "https://paypal.me/username" URL.
 */
function paypalUsername(handle: string): string | null {
  const trimmed = handle.trim()
  if (!trimmed) return null

  const match = trimmed.match(/paypal\.me\/([^/?#\s]+)/i)
  if (match?.[1]) return match[1]

  return cleanHandle(trimmed) || null
}

/**
 * Build the off-platform pay action for a selected method. Returns null when
 * the method has no off-platform link (cash / Stripe) or the handle/amount is
 * missing or unusable.
 */
export function buildPaymentDeepLink(args: {
  methodKey: string
  handle: string | null | undefined
  amountDue: number
  /** Free-text note for apps that support it (Venmo). Optional. */
  note?: string | null
}): PaymentDeepLink | null {
  const amount = normalizeAmount(args.amountDue)
  if (!amount) return null

  const rawHandle = typeof args.handle === 'string' ? args.handle.trim() : ''
  if (!rawHandle) return null

  switch (args.methodKey) {
    case 'venmo': {
      const user = cleanHandle(rawHandle)
      if (!user) return null

      const params = new URLSearchParams({ txn: 'pay', amount })
      const note = args.note?.trim()
      if (note) params.set('note', note)

      // venmo.com universal link: opens the Venmo app pre-filled on mobile,
      // falls back to the web flow on desktop.
      return {
        kind: 'link',
        href: `https://venmo.com/${encodeURIComponent(user)}?${params.toString()}`,
        label: `Pay $${amount} with Venmo`,
      }
    }

    case 'paypal': {
      const user = paypalUsername(rawHandle)
      if (!user) return null

      // PayPal.Me locks the amount into the URL path; currency is inferred.
      return {
        kind: 'link',
        href: `https://paypal.me/${encodeURIComponent(user)}/${amount}`,
        label: `Pay $${amount} with PayPal`,
      }
    }

    case 'zelle':
      return {
        kind: 'copy',
        handle: rawHandle,
        amount,
        instruction: `Open Zelle in your bank app and send $${amount} to ${rawHandle}.`,
      }

    case 'apple_cash':
      return {
        kind: 'copy',
        handle: rawHandle,
        amount,
        instruction: `Open Messages or Wallet and send $${amount} to ${rawHandle} with Apple Cash.`,
      }

    default:
      return null
  }
}
