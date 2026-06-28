// lib/checkout/nativeReturn.ts
//
// Single source of truth for the Stripe Checkout success/cancel return URLs.
//
// Web and native share the same `*/stripe-session` routes. Web callers want the
// hosted Stripe page to redirect back to an in-app `/client/bookings/{id}` page;
// native callers (the iOS app) can't catch an https return from inside an
// in-app browser, so they route through a public bounce page that hands off to
// the `tovis://` custom URL scheme (see `app/checkout/return`). A request is
// "native" when it carries the `x-tovis-return-target: native` header, which
// only the app sends — so web behavior is byte-for-byte unchanged.

export type CheckoutReturnKind = 'deposit' | 'checkout'
export type CheckoutReturnStatus = 'success' | 'cancelled'

/** The header the iOS app sends so we mint a `tovis://` deep-link return. */
export const NATIVE_RETURN_HEADER = 'x-tovis-return-target'

/** True when the request comes from the native app (asks for a deep-link return). */
export function isNativeCheckoutReturn(req: { headers: Headers }): boolean {
  return req.headers.get(NATIVE_RETURN_HEADER)?.trim().toLowerCase() === 'native'
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

/** The app's public base URL, e.g. `https://www.tovis.app`. */
export function getAppUrl(): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.VERCEL_URL

  if (!appUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL, APP_URL, or VERCEL_URL is required to create Stripe checkout sessions.',
    )
  }

  return normalizeBaseUrl(appUrl.startsWith('http') ? appUrl : `https://${appUrl}`)
}

/**
 * Build the Stripe `success_url` / `cancel_url` for a checkout/deposit session.
 *
 * - `native: false` (web) reproduces the historical in-app URLs exactly:
 *   - deposit  → `/client/bookings/{id}?deposit={status}`
 *   - checkout → `/client/bookings/{id}?step=aftercare&checkout={status}`
 * - `native: true` points at the public bounce route, which redirects to the
 *   `tovis://checkout/return` scheme so the app can dismiss the browser and
 *   refetch the booking.
 */
export function buildCheckoutReturnUrl(args: {
  bookingId: string
  status: CheckoutReturnStatus
  kind: CheckoutReturnKind
  native: boolean
}): string {
  const appUrl = getAppUrl()

  if (args.native) {
    const url = new URL('/checkout/return', appUrl)
    url.searchParams.set('status', args.status)
    url.searchParams.set('kind', args.kind)
    url.searchParams.set('bookingId', args.bookingId)
    return url.toString()
  }

  const url = new URL(
    `/client/bookings/${encodeURIComponent(args.bookingId)}`,
    appUrl,
  )

  if (args.kind === 'deposit') {
    url.searchParams.set('deposit', args.status)
  } else {
    url.searchParams.set('step', 'aftercare')
    url.searchParams.set('checkout', args.status)
  }

  return url.toString()
}
