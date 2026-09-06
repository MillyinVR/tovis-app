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
      eyebrow: 'BEAUTY · BOOKING · REINVENTED',
      headlineTop: 'Beauty booking',
      headlineBottom: 'finally got its upgrade.',
      intro:
        `Rides, food, flights, banking: everything in your life got smarter. Booking a beauty pro? Still phone tag, "text me a picture," and a paper card file. ${brandName} brings the chair into the modern world: a feed of real looks from real pros near you, where every look is bookable, by a professional who keeps every dollar you pay.`,
      ctaClient: 'Find your look',
      ctaPro: "I'm a professional",
      ctaBrowse: 'Browse looks without an account →',
      ctaWhy: 'How the money works →',
    },

    legend: {
      live: 'Live',
      rollingOut: 'Rolling out',
    },

    manifesto: ['See it.', 'Book it.', 'Keep it.'],

    loop: {
      label: 'The loop',
      title: 'From a look you love to a time that is yours, in two taps.',
      steps: [
        {
          title: 'Bookable Looks',
          body: 'Real results from real appointments, posted by the professionals who did them. Every look carries a starting price and a Book button. No DM, no guessing.',
          state: 'live',
          evidence:
            'Book the Look B1–B8 merged and web-deployed 2026-09-01; starting price from lib/looks/startingPrice.ts; Book CTA on the feed card.',
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
      label: 'For clients',
      title: 'Book the look, not the service.',
      intro: 'You know what you want to look like. You should not have to translate it into a menu.',
      features: [
        {
          title: 'Scroll like you already do',
          body: 'A feed of real results by category. Browse the look you want, not a list of service names.',
          state: 'live',
          evidence: '/looks feed with category tabs (LooksTopBar); B1 de-serviced the feed (#1040, deployed 2026-09-01).',
        },
        {
          title: 'Tap the look. Book it.',
          body: 'Every look carries a starting price and a Book button. From scrolling to a held time in one tap.',
          state: 'live',
          evidence: 'Book the Look B1–B8 merged and web-deployed 2026-09-01; lib/looks/startingPrice.ts; Book CTA on the feed card.',
        },
        {
          title: 'New city? Scout it first',
          body: 'Type any neighbourhood and see who is available there before you arrive.',
          state: 'live',
          evidence: 'Search takes a typed place (Places autocomplete in app/(main)/search/SearchMapClient.tsx); /api/v1/pros/nearby.',
        },
        {
          title: 'Booked out? Get in line',
          body: 'Join their waitlist. When your pro frees a spot, you get the offer first, straight to your phone.',
          state: 'live',
          evidence: 'Waitlist entries + pro-sent offers (app/api/v1/pro/waitlist/[entryId]/offer) notify via WAITLIST_TIME_OFFERED; last-minute openings feed + priority offers (lib/lastMinute).',
        },
        {
          title: 'Aftercare that remembers for you',
          body: 'How to keep it up at home, when to rebook, and the products your pro recommended. All in one place, so nothing gets forgotten.',
          state: 'live',
          evidence: 'Aftercare inbox + rebook picker; ProductRecommendation on AftercareSummary (prisma/schema.prisma) rendered on the client booking page.',
        },
        {
          title: 'Post it. Inspire. Get paid.',
          body: 'Share your own results. When someone books from your look, you earn a credit toward your next appointment. The easiest referral bonus you will ever get.',
          state: 'rolling-out',
          evidence: 'Client-authored looks via share-look (app/api/v1/client/bookings/[id]/share-look); creator credit 3% minted on COMPLETION (lib/credit/clientCredit.ts, #947); spend at checkout needs Stripe, which is on hold / test mode, and the settlement transfer leg has never run (memory: creator-credit-rate-and-trigger, checked 2026-09-05).',
        },
        {
          title: 'A chart that travels with you',
          body: 'Your history is yours. Share it with a new pro for 30 days, then it closes on its own.',
          state: 'live',
          evidence: 'Consent-gated client chart sharing with 30-day windows (Aug 2026 code audit).',
        },
        {
          title: 'Refer with a tap',
          body: 'Hold your phone to a friend’s. That is the whole referral.',
          state: 'live',
          evidence: 'NFC tap-to-claim referrals (Aug 2026 code audit).',
        },
        {
          title: 'The iPhone app',
          body: 'In beta testing now. The web works on every phone today.',
          state: 'rolling-out',
          evidence: 'tovis-ios on TestFlight only, not in the App Store (app-store-submission-state, 2026-09-01: build 63 archived, TestFlight only).',
        },
      ],
    },

    // Two rows LIFTED out of the lists below, not copied into a third one.
    // The camera used to sit in `pros.features`; the consult has never been on
    // this page at all. Both are rolling out, and both say so twice: the state
    // pill, and the last chip naming the actual limit. A spotlight is the
    // loudest thing on a page, so it is the last place a caveat should be
    // quiet.
    spotlight: {
      label: 'Not on the menu anywhere else',
      title: 'Two things that make the guesswork',
      titleAccent: 'disappear.',
      features: [
        {
          eyebrow: 'Smart consultation',
          title: 'You bring the photo. We name the service.',
          body: 'Answer a handful of quick questions and drop in the shots you saved. Instead of picking a menu item and hoping it means the picture in your camera roll, you get told which service actually gets you there.',
          aside: 'Running with one professional today while the results are checked by hand.',
          chips: ['Bring your own photos', 'Names the service', 'Founder pilot'],
          state: 'rolling-out',
          // The allowlist is the limit this row claims, because it is the one
          // that can be READ here: lib/consult/access.ts gates on
          // ENABLE_AI_CONSULT (absent reads as off) OR a hardcoded array that
          // holds exactly one id. The category kill switch is deliberately NOT
          // claimed — lib/consult/serviceScope.ts defaults to ALL_SERVICES and
          // only narrows when AI_CONSULT_SERVICE_SCOPE is set, and this
          // repository cannot read prod's environment. Do not describe the
          // consult as colour-only on the strength of that switch without a
          // runtime probe saying so.
          evidence:
            'lib/consult/access.ts: ENABLE_AI_CONSULT defaults OFF and AI_CONSULT_PRO_ALLOWLIST holds exactly one id (founder testing account), read from source 2026-09-06. Analysis deployed 2026-09-05 (P4a/P4b). Prod value of AI_CONSULT_SERVICE_SCOPE is UNVERIFIED; the code default is ALL_SERVICES.',
        },
        {
          eyebrow: 'Smart camera',
          title: 'A photographer in your pocket.',
          body: 'It reads the light, finds the angle, and talks you through the shot the way a photographer standing next to you would, then catches the retake before it ever reaches your grid. The finished work looks as good as the work.',
          aside: 'Five coaching personalities, from Calm Mentor to Hype Bestie. Practice mode sharpens your off days.',
          chips: ['Reads the light', 'Guides the angle', 'Catches the retake', 'iPhone beta'],
          state: 'rolling-out',
          evidence:
            'Camera subsystem (capture coaching, QC retakes, personality packs) is iOS-only (Aug 2026 code audit); iOS is in TestFlight, not the App Store (build 63 archived 2026-09-01; checked 2026-09-05).',
        },
      ],
    },

    pros: {
      label: 'For professionals',
      title: 'Run the chair. We’ll run everything else.',
      intro: 'Every look you post is bookable. Everything after the tap is handled.',
      features: [
        {
          title: 'Looks that book themselves',
          body: 'Post a result, it carries a starting price and a Book button. Clients book the look; you see exactly what they are asking for.',
          state: 'live',
          evidence: 'Book the Look B1–B8 merged and web-deployed 2026-09-01; pro sees the proposal line items (B4/B5).',
        },
        {
          title: 'Held, not hoped',
          body: 'A request holds the time the moment it lands. Confirm every one, or switch on instant booking and let the calendar fill itself.',
          state: 'live',
          evidence: 'PENDING owns its slot (BOOKING_BLOCKING_STATUSES, DB EXCLUDE-backed); Professional.autoAcceptBookings toggle (docs/product/BOOK-THE-LOOK-DIRECTION.md decision 4).',
        },
        {
          title: 'A cancellation is never a lost hour',
          body: 'The last-minute engine works your openings for you: your waitlist first, then clients who have drifted, then nearby fans of your work.',
          state: 'live',
          evidence: 'LastMinuteTier WAITLIST → REACTIVATION → DISCOVERY (prisma/schema.prisma:199); last-minute job app/api/internal/jobs/last-minute; lib/lastMinute/pickTierPlan.ts.',
        },
        {
          title: 'Their place or yours',
          body: 'Take appointments at the salon, the suite, or at the client’s door. The calendar knows the difference.',
          state: 'live',
          evidence: 'ProfessionalLocationType SALON | SUITE | MOBILE_BASE; Booking.clientAddressId (prisma/schema.prisma).',
        },
        {
          title: 'Your work, everywhere your audience lives',
          body: 'One tap turns any look into a post-ready export, always credited to you. Grow where you already post.',
          state: 'live',
          evidence: 'Social export on web: app/_components/media/ClientMediaExportButton.tsx, lib/pro/socialExportMark.ts (Aug 2026 code audit: 4:5 / 9:16 / video, pro-credited).',
        },
        {
          title: 'Charts and consent, built in',
          body: 'Notes, allergies, visit history, photos, and signed consent on every client. Not in a notes app.',
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
          evidence: 'Migration import wizard; prod runtime probe 2026-08-25 GET /api/v1/pro/capabilities → importFromAnotherApp: true.',
        },
        {
          title: 'Ranked by bookings, not followers',
          body: 'The feed lifts a look by the appointments it produced. A great stylist with a small following outranks a big account nobody books.',
          state: 'rolling-out',
          evidence: 'Booking-conversion boost in lib/looks/personalizedRanking.ts fed by the look-conversion-stats job; ENABLE_PERSONALIZED_FEED is set in prod but its value is Hidden and UNVERIFIED (2026-09-05). Do not promote to live without a runtime probe.',
        },
        {
          title: 'Deposits that enforce themselves',
          body: 'A deposit at booking and a late-cancel policy that does the awkward part for you.',
          state: 'rolling-out',
          evidence: 'No-show protection built, ENABLE_NO_SHOW_PROTECTION → noShowFees: false in prod (probe 2026-08-25); Stripe on hold, prod Stripe in test mode.',
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

    // Makes no capability claim, so it carries no state: it repeats the hero's
    // two buttons and nothing else.
    closer: {
      title: 'The chair is open.',
      titleAccent: 'Take it.',
    },

    next: {
      label: 'What’s next',
      title: 'We publish what is built, not what is promised.',
      body: 'Everything marked rolling out is in the product today, behind a switch or a beta. Everything else we are working on stays off this page until it is real.',
      verifiedPrefix: 'Every claim on this page was checked against the product on',
    },
  }
}
