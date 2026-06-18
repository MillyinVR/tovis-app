// lib/membership/urls.ts
// Return URLs for Stripe Billing Checkout / Portal sessions.

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function getAppUrl(): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.VERCEL_URL

  if (!appUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL, APP_URL, or VERCEL_URL is required for membership checkout.',
    )
  }

  return normalizeBaseUrl(appUrl.startsWith('http') ? appUrl : `https://${appUrl}`)
}

export function membershipReturnUrl(status: 'success' | 'cancelled'): string {
  const url = new URL('/pro/membership', getAppUrl())
  url.searchParams.set('checkout', status)
  return url.toString()
}

export function membershipPortalReturnUrl(): string {
  return new URL('/pro/membership', getAppUrl()).toString()
}
