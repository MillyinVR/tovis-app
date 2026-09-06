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
// Live feature rows retain two states. The separately labelled editorial
// preview describes upcoming concepts at the user's request (2026-09-06);
// those concepts are never included in the live feature list or JSON-LD.
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
    editorial: {
      heroImage: { src: '/editorial/placeholders/next-self-inclusive-hero.webp', alt: 'Generated editorial portrait of two men and two women with textured cuts, a groomed beard, natural curls, and copper waves' },
      looks: [
        { src: '/editorial/placeholders/golden-hour-blonde.webp', label: 'Blonde', alt: 'Generated editorial portrait featuring long honey blonde waves' },
        { src: '/editorial/placeholders/precision-barbering.webp', label: 'Barbering', alt: 'Generated editorial portrait featuring a textured short haircut and a shaped salt-and-pepper beard' },
        { src: '/editorial/placeholders/silk-glaze-nails.webp', label: 'Nails', alt: 'Generated editorial close-up of champagne glazed almond nails' },
        { src: '/editorial/placeholders/soft-focus-brows.webp', label: 'Brows & lashes', alt: 'Generated editorial beauty portrait highlighting natural brows and lifted lashes' },
      ],
      location: 'Discover your next look',
      discoveryTitle: 'What are you becoming next?',
      placeholderLabel: 'Generated editorial imagery · Placeholder inspiration, not professional results',
      categories: ['Barbering', 'Cuts & color', 'Beards', 'Curls', 'Extensions', 'Nails', 'Brows & lashes', 'Skin & makeup', 'Bridal'],
      journey: [
        { title: 'Bring the inspiration', body: 'Start with a saved photo and tell us what you love about it.' },
        { title: 'Make it personal', body: 'Share your starting point, beauty history, and how much upkeep fits your life.' },
        { title: 'Meet your Look Brief', body: 'A starting point for a conversation with your professional about the look and the path to it.' },
      ],
      journeyNote: 'Journey preview. Consultation and Look Brief access is currently limited to the founder pilot. Your professional confirms suitability, services, and the final plan.',
      trustTitle: 'Know before you book',
      trustBody: 'Explore the work. Meet the professional. Check the starting price and discuss what your look will take. A starting price is not a personalized quote.',
      // Brand-specific launch programs are opt-in through the brand config.
      foundingTitle: '',
      foundingBody: '',
      foundingCard: '',
      upcomingLabel: 'Coming soon · Program preview',
      progression: [],
      progressionBody: '',
    },
    verifiedOn: '2026-09-05',
    // Rendered as literal prose, not formatted from a Date, so it needs no
    // timezone and never drifts with the server clock.
    verifiedOnLabel: 'September 5, 2026',

    hero: {
      eyebrow: 'BEAUTY, REIMAGINED',
      headlineTop: 'See the look.',
      headlineBottom: 'Make it yours.',
      intro:
        `Start with what inspires you. Discover looks, find the professional behind them, and take the next step toward your next version of you with ${brandName}.`,
      ctaClient: 'Find your look',
      ctaPro: "I'm a professional",
      ctaBrowse: 'Browse looks without an account →',
      ctaWhy: 'How the money works →',
    },

    legend: {
      live: 'Live',
      rollingOut: 'Rolling out',
    },

    manifesto: ['Find inspiration.', 'Become you.'],

    loop: {
      label: 'The loop',
      title: 'Inspiration. Meet your next appointment.',
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
        { tool: 'A notes app for client details', withWhat: 'A chart on every client: notes, allergies, visit history, photos' },
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

    // LIFTED out of clients.features (it was "A chart that travels with you"),
    // because it is the one thing on this page that compounds: the value of
    // every other row is the same on visit one and visit ten, and this one is
    // not.
    //
    // 🔴 What this band must NOT say. The row it replaces read "Share it with a
    // new pro for 30 days, then it closes on its own," which welded two
    // different mechanisms together and got the reassuring half backwards:
    //
    //   • A BOOKING opens the chart (PENDING, upcoming ACCEPTED, in progress)
    //     and closes it RECENT_COMPLETED_WINDOW_DAYS = 30 after the visit
    //     completes. That one really does close on its own.
    //   • A ClientChartShare GRANT is open-ended. lib/clientVisibility.ts
    //     returns accessUntil: null for it. It ends when the client revokes and
    //     not before.
    //
    // Telling someone an explicit grant expires when it does not is the
    // dangerous direction of that error, so the two are stated separately below
    // and neither borrows the other's guarantee.
    //
    // 🔴 And what it must not imply: nothing READS this history to improve a
    // result automatically. The consult does not touch the chart (grepped
    // 2026-09-06). The mechanism is a professional reading it, which is why the
    // copy credits the person and never the platform.
    chart: {
      label: 'The chart',
      title: 'The only appointment that starts from scratch is',
      titleAccent: 'your first.',
      body: 'Every visit writes to your chart: the products used, the notes on what worked and what did not, and the photos from the day. Book again and your professional opens it before you arrive, so you start where you left off instead of describing your last appointment from memory.',
      aside: 'You decide who sees it. A booking opens your chart to that professional and closes it thirty days after the visit, on its own. Anything past that is a grant you make, and you can take it back whenever you want.',
      points: [
        {
          label: 'What it holds',
          body: 'Notes, allergies, every visit with its photos, the products used, and the feedback your professional left.',
        },
        {
          label: 'When they read it',
          body: 'From the moment you request the time, so your professional walks in already knowing.',
        },
        {
          label: 'Who decides',
          body: 'You do. Grant a new professional access, revoke it later, and the booking window closes itself.',
        },
      ],
      state: 'live',
      // 🔴 The technical record (formulas) is NOT claimed here and must not be
      // added. lib/clients/chartTabs.ts marks that tab "Flag-gated
      // (ENABLE_CLIENT_TECHNICAL_RECORD); only shown/queried when on", and
      // lib/clients/technicalRecord.ts keeps the flag off with a one-id founder
      // allowlist while the surface is legal-gated. This row is `live`, so it
      // may only name the tabs that are live: notes, allergies, visits with
      // their photos, products, and pro feedback.
      evidence:
        'lib/clients/chartTabs.ts: notes, allergies, visits (each visit card carries its frames), products, reviews and pro feedback are unflagged; the technical-record tab is gated on ENABLE_CLIENT_TECHNICAL_RECORD and is deliberately not named above. lib/clientVisibility.ts proClientVisibilityWhere grants the chart on PENDING and upcoming ACCEPTED bookings, so access precedes the appointment, and RECENT_COMPLETED_WINDOW_DAYS = 30 closes it after a completed visit. Explicit sharing is client-granted and client-revocable (lib/clients/chartShare.ts, app/api/v1/client/chart-shares). Read from source 2026-09-06.',
    },

    // Two rows LIFTED out of the lists below, not copied into a third one.
    // The camera used to sit in `pros.features`; the consult has never been on
    // this page at all. Both are rolling out, and both say so twice: the state
    // pill, and the last chip naming the actual limit. A spotlight is the
    // loudest thing on a page, so it is the last place a caveat should be
    // quiet.
    spotlight: {
      label: 'Consultation · Founder pilot',
      title: 'You don’t need to know',
      titleAccent: 'what it’s called.',
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
      title: 'Your work deserves to be seen.',
      intro: 'Get discovered for your craft. Build relationships that last. Give your reputation room to grow.',
      features: [
        {
          title: 'Discovery that starts with your work',
          body: 'Let clients find the looks you create, explore your profile, and book with you.',
          state: 'live',
          evidence: 'Book the Look B1–B8 merged and web-deployed 2026-09-01; public /u/[handle] profile and Looks feed.',
        },
        {
          title: 'Relationships beyond one appointment',
          body: 'Keep notes, visit history, photos, and consent together so you can build on every visit.',
          state: 'live',
          evidence: 'Client charts + technical records + consent forms (Aug 2026 code audit); current chart band evidence below.',
        },
        {
          title: 'A reputation that grows with you',
          body: 'Build your public portfolio and share credited exports of your work wherever your audience lives.',
          state: 'live',
          evidence: 'Social export on web: app/_components/media/ClientMediaExportButton.tsx, lib/pro/socialExportMark.ts (Aug 2026 code audit).',
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
      title: 'Your next look',
      titleAccent: 'starts here.',
    },

    next: {
      label: 'What’s next',
      title: 'A little clarity goes a long way.',
      body: 'Live features are available today. Rolling out means access is limited. Coming-soon concepts are previews, with details still to be confirmed.',
      verifiedPrefix: 'Existing feature review:',
    },
  }
}
