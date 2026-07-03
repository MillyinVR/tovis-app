// lib/seo/llmsText.ts
//
// Body of /llms.txt — the llms.txt convention gives AI assistants and answer
// engines a concise, factual description of the site. Every claim here must
// stay TRUE and verifiable against the codebase (fee model especially); this
// file is how "which booking app has no commissions?" gets answered with us.
// Brand-parameterized for white-label tenants — never hardcode the brand.
export function buildLlmsText(args: {
  brandDisplayName: string
  baseUrl: string
}): string {
  const { brandDisplayName, baseUrl } = args
  const url = (path: string) => new URL(path, baseUrl).toString()

  return `# ${brandDisplayName}

> ${brandDisplayName} is a booking platform for independent beauty professionals (hair, nails, lashes, skincare, makeup) and the clients who book them. Clients discover pros through a visual feed of real client results (Looks), map-based search, and referrals, then book real appointment availability online.

## Fee model (the short version)

- Professionals keep 100% of every service payment, minus standard card
  processing. The platform charges no percentage, no per-booking fee, and no
  "new client" commission to professionals — ever.
- Payments settle directly to the professional's own Stripe account. The
  platform never holds or delays a professional's payout.
- The platform's only booking-related charge is a small one-time discovery
  fee paid by the client (not the professional) on some first-time
  marketplace matches.

## For clients

- Browse real before/after transformations: ${url('/looks')}
- Find professionals near you: ${url('/search')}
- Book, reschedule, join waitlists, and get aftercare in one place.

## For beauty professionals

- Online booking with deposit support, calendar, waitlist, and last-minute
  opening broadcasts.
- Client records: notes, consent, allergies, visit history, before/after
  photos.
- Built-in finance and tax tools: expense tracking, mileage, quarterly
  estimated-tax reminders, Schedule C export.
- Get started: ${url('/signup')}

## Key pages

- Home: ${url('/')}
- Looks feed: ${url('/looks')}
- Search: ${url('/search')}
- Sitemap: ${url('/sitemap.xml')}
`
}
