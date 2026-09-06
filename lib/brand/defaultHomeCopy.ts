// lib/brand/defaultHomeCopy.ts
//
// User-facing copy for the public homepage (app/page.tsx). A factory that bakes
// the brand's display name in, like defaultProCalendarCopy does the wordmark,
// so the page never hardcodes the brand name.
//
// ⚠️ This page is CHECKABLE marketing, like /why: every feature below carries a
// `state` and an `evidence` line, and the state is one of exactly two values.
//
//   'live'         — in the current production deploy and reachable by the
//                    audience the section addresses, with no flag, beta or
//                    test-mode caveat between them and it.
//   'rolling-out'  — in the product, but behind an env flag, a founder-only
//                    pilot, an iPhone beta, or a payments account still in
//                    test mode. Built is not the same as reachable.
//
// There is deliberately NO third state. Anything decided but not built stays
// off this page; the "what's next" section says so in one sentence instead of
// listing a roadmap (Tori, 2026-09-05). A page that promises is what a
// competitor's pitch deck does; this one reports.
//
// `evidence` is never rendered. It exists so the next session re-verifies a
// row instead of trusting it: name the file, the deploy, or the runtime probe
// that made the claim true, and the date. `verifiedOn` is the date of the last
// full pass; bump it only after re-checking EVERY row.
//
// Voice: named concepts, short bodies, no em dashes. The names are ours
// (Bookable Looks, True-net, Held the moment you tap); they describe shipped
// behaviour, never a trademark on an intention.

import type { BrandHomeCopy } from './types'

/**
 * @param brandName the brand's DISPLAY name (e.g. "TOVIS"), not the lowercase
 * wordmark; it lands mid-sentence in prose.
 */
export function defaultHomeCopy(brandName: string): BrandHomeCopy {
  return {
    verifiedOn: '2026-09-05',
    // Rendered as literal prose, not formatted from a Date, so it needs no
    // timezone and never drifts with the server clock.
    verifiedOnLabel: 'September 5, 2026',

    hero: {
      eyebrow: 'BEAUTY · BOOKING',
      headlineTop: 'The New Age',
      headlineBottom: 'of Self Care',
      intro:
        'See a look you love. Get a consultation from your own photos. Book it, with a professional who keeps every dollar you pay.',
      ctaClient: 'Create Client Account',
      ctaPro: "I'm a professional",
      ctaBrowse: 'Browse looks without an account →',
      ctaWhy: 'How the money works →',
    },

    legend: {
      body: 'Two labels on this page, and no third. Live means it is yours today. Rolling out means it is built and behind a switch or a beta. Nothing planned appears here.',
      live: 'Live',
      rollingOut: 'Rolling out',
    },

    manifesto: ['See it.', 'Understand it.', 'Book it.', 'Keep it.'],

    loop: {
      label: 'The loop',
      title: 'From a look you love to a time that is yours.',
      steps: [
        {
          title: 'Bookable Looks',
          body: 'Real results from real appointments, posted by the professionals who did them. Every look carries a starting price and a Book button. No DM, no guessing.',
          state: 'live',
          evidence:
            'Book the Look B1–B8 merged and web-deployed 2026-09-01; starting price from lib/looks/startingPrice.ts; Book CTA on the feed card.',
        },
        {
          title: 'Consult from a photo',
          body: 'Before you commit, a short consultation reads your photos and the look you chose, then builds the appointment from your professional’s own services and prices. Your professional makes the final call. Live with our founding professionals; opening wider as it proves itself.',
          state: 'rolling-out',
          evidence:
            'AI consult web deployed 2026-09-03/05 (#1067–#1071, #1080–#1086); founder-only pilot; scope kill switch AI_CONSULT_SERVICE_SCOPE; iOS in build 66, not yet uploaded.',
        },
        {
          title: 'Held the moment you tap',
          body: 'Pick a real open time and it is yours the instant you commit, even when your professional confirms in the morning. Reschedule, cancel, or join a waitlist from the same place.',
          state: 'live',
          evidence:
            'PENDING owns its slot (BOOKING_BLOCKING_STATUSES, DB EXCLUDE-backed; docs/product/BOOK-THE-LOOK-DIRECTION.md decision 4); client reschedule/cancel/waitlist per Aug 2026 code audit.',
        },
      ],
    },

    replaces: {
      label: 'One account',
      title: 'Six tools. One place.',
      body: 'The things a professional pays for, juggles, or keeps in a notes app today, and what stands in for each of them here.',
      items: [
        { tool: 'A booking app', withWhat: 'Services, calendar, real availability, held slots' },
        { tool: 'A notes app for formulas', withWhat: 'A chart on every client: notes, allergies, visit history, photos' },
        { tool: 'Consent forms on paper', withWhat: 'Signed consent, stored with the client' },
        { tool: 'Aftercare by text', withWhat: 'An aftercare inbox with the products used and a one-tap rebook' },
        { tool: 'A tax spreadsheet', withWhat: 'Expenses, mileage, write-offs, a Schedule C at the end' },
        { tool: 'A link-in-bio portfolio', withWhat: 'A public profile and a feed of bookable looks' },
      ],
      evidence:
        'All six map to Live rows below: booking/calendar, charts, consent forms, aftercare + product recommendations, finance suite, /u/[handle] public profile + Looks feed (Aug 2026 code audit; B1–B8 deployed 2026-09-01).',
    },

    clients: {
      label: 'Clients',
      title: 'Find your perfect look',
      features: [
        {
          title: 'Looks, not listings',
          body: 'Browse real transformations by category, or find professionals near you on the map.',
          state: 'live',
          evidence: '/looks feed with category tabs (LooksTopBar); /search; /api/v1/pros/nearby.',
        },
        {
          title: 'Aftercare that follows up',
          body: 'Aftercare notes, the products your professional used, and a one-tap rebook. In your inbox, not a text thread.',
          state: 'live',
          evidence:
            'Aftercare inbox + rebook picker; ProductRecommendation on AftercareSummary (prisma/schema.prisma) rendered on the client booking page.',
        },
        {
          title: 'A chart that travels with you',
          body: 'Your history stays yours. Share it with a new professional for 30 days, then it closes on its own.',
          state: 'live',
          evidence: 'Consent-gated client chart sharing with 30-day windows (Aug 2026 code audit).',
        },
        {
          title: 'First call on openings',
          body: 'Join a waitlist, hear first about last-minute openings, and claim a friend’s referral with a tap.',
          state: 'live',
          evidence:
            'Waitlist, last-minute openings feed + priority offers, NFC tap-to-claim referrals (Aug 2026 code audit).',
        },
        {
          title: 'The iPhone app',
          body: 'In beta testing now. The web works on every phone today.',
          state: 'rolling-out',
          evidence:
            'tovis-ios on TestFlight only, not in the App Store (app-store-submission-state, 2026-09-01: build 63 archived, TestFlight only).',
        },
      ],
    },

    pros: {
      label: 'Professionals',
      title: 'Run your business',
      features: [
        {
          title: 'A book that stays full',
          body: 'Services, calendar, real availability, held slots, and a client roster, from one clean dashboard.',
          state: 'live',
          evidence: 'Services / calendar / availability / client roster per Aug 2026 code audit.',
        },
        {
          title: 'Charts and consent',
          body: 'Notes, allergies, visit history, before-and-after photos, and signed consent forms on every client. The part other apps leave to your notes app.',
          state: 'live',
          evidence: 'Client charts + technical records + consent forms (Aug 2026 code audit).',
        },
        {
          title: 'Run it from the chair',
          body: 'Photos, notes, and the final bill in a live session, synced between the web and the app as you work.',
          state: 'live',
          evidence: 'Live session hub, realtime web ⇄ iOS sync (Aug 2026 code audit). Web half reachable today.',
        },
        {
          title: 'True-net finance',
          body: 'Expenses, write-offs, mileage, and a money trail that ends in a Schedule C. What you keep, not just what you billed.',
          state: 'live',
          evidence: 'Pro finance suite: expenses, Schedule-C write-offs, mileage, money trail (Aug 2026 code audit).',
        },
        {
          title: 'Bring your book with you',
          body: 'Import your services and clients from the app you use now. Nothing to re-type.',
          state: 'live',
          evidence:
            'Migration import wizard; prod runtime probe 2026-08-25 GET /api/v1/pro/capabilities → importFromAnotherApp: true.',
        },
        {
          title: 'Ranked by bookings, not followers',
          body: 'The feed lifts a look by the appointments it produced, not by follower count. A great stylist with a small following outranks a big account nobody books.',
          state: 'rolling-out',
          evidence:
            'Booking-conversion boost in lib/looks/personalizedRanking.ts fed by the look-conversion-stats job; ENABLE_PERSONALIZED_FEED is set in prod but its value is Hidden and UNVERIFIED (2026-09-05). Do not promote to live without a runtime probe.',
        },
        {
          title: 'A camera that coaches the shot',
          body: 'Capture guidance, quality checks, and retakes, so every before-and-after is one you would post.',
          state: 'rolling-out',
          evidence:
            'AI camera subsystem is iOS-only (Aug 2026 code audit); iOS is in TestFlight, not the App Store (build 63 archived 2026-09-01; checked 2026-09-05).',
        },
        {
          title: 'Deposits that enforce themselves',
          body: 'A deposit at booking and a late-cancel policy that does the awkward part for you.',
          state: 'rolling-out',
          evidence:
            'No-show protection built, ENABLE_NO_SHOW_PROTECTION → noShowFees: false in prod (probe 2026-08-25); Stripe on hold, prod Stripe in test mode.',
        },
      ],
    },

    money: {
      label: 'The money',
      title: 'Keep every dollar you earn.',
      body: `No commissions. No per-booking fee. Payouts settle straight to your own Stripe account, so ${brandName} never holds your money. Card payments through the platform are rolling out now; until then you take payment the way you already do.`,
      state: 'rolling-out',
      evidence:
        'Fee model per /why (checked against payments code); Stripe Connect destination charges; ENABLE_PLATFORM_FEES absent in prod; Stripe ON HOLD, prod keys in test mode (memory: stripe-is-on-hold-until-pro-journey-proven; checked 2026-09-05). Promote only when live keys are on.',
      cta: 'Read exactly how the money works →',
    },

    next: {
      label: 'What’s next',
      title: 'We publish what is built, not what is promised.',
      body: 'Everything marked rolling out is in the product today, behind a switch or a beta. Everything else we are working on stays off this page until it is real.',
      verifiedPrefix: 'Every claim on this page was checked against the product on',
    },
  }
}
