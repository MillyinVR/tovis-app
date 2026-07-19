// app/checkout/return/route.ts
//
// Public bounce page for the native checkout return. Stripe Checkout requires an
// http(s) `success_url`/`cancel_url`, but the iOS app needs to be handed back via
// its custom URL scheme. So native checkout/deposit sessions point Stripe here,
// and this page immediately redirects to `tovis://checkout/return?…`, which the
// app intercepts (dismisses the in-app browser + refetches the booking).
//
// Public by design — Stripe redirects an unauthenticated browser to it. It
// echoes only whitelisted, sanitized params and never touches the database.

import type { NextRequest } from 'next/server'

import { getBrandConfig } from '@/lib/brand'

export const dynamic = 'force-dynamic'

const APP_SCHEME = 'tovis'

function pickStatus(value: string | null): 'success' | 'cancelled' {
  return value === 'cancelled' ? 'cancelled' : 'success'
}

function pickKind(value: string | null): 'deposit' | 'checkout' {
  return value === 'deposit' ? 'deposit' : 'checkout'
}

// Booking ids are cuid/uuid-shaped; reject anything else so we can't be coerced
// into building a deep link with attacker-controlled junk.
function sanitizeBookingId(value: string | null): string {
  return value && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : ''
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function GET(req: NextRequest): Response {
  const { searchParams } = req.nextUrl

  const status = pickStatus(searchParams.get('status'))
  const kind = pickKind(searchParams.get('kind'))
  const bookingId = sanitizeBookingId(searchParams.get('bookingId'))

  const deepLink = `${APP_SCHEME}://checkout/return?status=${status}&kind=${kind}&bookingId=${encodeURIComponent(bookingId)}`
  const safeLink = escapeHtml(deepLink)

  const heading =
    status === 'cancelled' ? 'Checkout cancelled' : 'Payment received'
  const body =
    status === 'cancelled'
      ? 'No charge was made. Returning you to the app…'
      : 'Thanks! Returning you to the app…'

  // This bounce page is a standalone document — it never loads globals.css, so
  // the brand tokens have to be emitted inline rather than inherited. The dark
  // palette is taken deliberately (the page pins `color-scheme: dark`): it is
  // on screen for a few hundred milliseconds before the deep link fires, so a
  // light/dark negotiation would only buy a flash. Sourcing them from the brand
  // config is what keeps this page white-label instead of the previous
  // off-brand purple.
  const { colors } = getBrandConfig().tokensByMode.dark

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(heading)}</title>
<style>
  :root {
    color-scheme: dark;
    --bg-primary: ${colors.bgPrimary};
    --text-primary: ${colors.textPrimary};
    --text-muted: ${colors.textMuted};
    --accent-primary: ${colors.accentPrimary};
    --on-accent: ${colors.onAccent};
  }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: rgb(var(--bg-primary)); color: rgb(var(--text-primary));
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    text-align: center; padding: 24px;
  }
  .card { max-width: 22rem; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { font-size: 0.95rem; line-height: 1.4; color: rgb(var(--text-muted)); margin: 0 0 1.5rem; }
  a.btn {
    display: inline-block; text-decoration: none; font-weight: 600;
    padding: 0.85rem 1.4rem; border-radius: 0.85rem;
    background: rgb(var(--accent-primary)); color: rgb(var(--on-accent));
  }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(body)}</p>
    <a class="btn" href="${safeLink}">Return to the app</a>
  </div>
  <script>
    // Hand off to the native app. The visible button is the manual fallback if
    // the automatic redirect is blocked.
    window.location.replace(${JSON.stringify(deepLink)});
  </script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
