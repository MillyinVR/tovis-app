// app/page.tsx
import Link from 'next/link'
import { buildTransactionalSmsPageCopy } from '@/lib/transactionalSmsPolicy'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const dynamic = 'force-dynamic'

const footerLinks = [
  { href: '/about', label: 'About' },
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
] as const

type Feature = { lead: string; text: string }

// Every line below maps to a shipped, all-users-live capability. Nothing
// pilot-gated or flag-gated-dark appears here. Copy rules (2026-09-05):
// never the word "AI" — "smart" / "learns with you" / "coaches like a
// mentor" instead — and the page leads on the industry-upgrade story.
const clientFeatures: Feature[] = [
  {
    lead: 'Scroll like you already know how.',
    text: 'A feed of real looks from real pros near you — browse balayages, not service lists.',
  },
  {
    lead: 'Book the look in the same breath.',
    text: 'Every look comes from a pro who can actually give it to you. No DMs, no phone tag — you see it, you book it.',
  },
  {
    lead: 'The pro you want is booked? Get in line.',
    text: 'Join the waitlist and get notified the minute a last-minute spot opens up.',
  },
  {
    lead: 'New in town — or just visiting?',
    text: 'Discover who’s available in your new area before you get there.',
  },
  {
    lead: 'Show off your looks. Inspire others. Earn credit.',
    text: 'Share the looks you love, and referring friends earns you credit toward your next booking — the easiest referral bonus you’ll ever get.',
  },
  {
    lead: 'Never forget the upkeep.',
    text: 'Aftercare keeps your at-home instructions, your rebook timing, and the exact products your pro recommended — all in one place, so nothing slips.',
  },
]

const proFeatures: Feature[] = [
  {
    lead: 'A cancellation is never a lost hour.',
    text: 'The last-minute engine works your openings automatically — your waitlist first, then clients who’ve drifted, then nearby fans of your work.',
  },
  {
    lead: 'A waitlist that wants you.',
    text: 'Clients get notified the second a spot opens — and can book mobile appointments where you come to them.',
  },
  {
    lead: 'A camera that coaches like a mentor.',
    text: 'It reads the light, catches the retake before you post it, and speaks in your choice of five personalities — from Calm Mentor to Hype Bestie. Practice mode sharpens your off days.',
  },
  {
    lead: 'Your client’s whole story, in one chart.',
    text: 'Every visit, every note, consent-first sharing — the card file, reinvented.',
  },
  {
    lead: 'A money trail that does your taxes.',
    text: 'Expenses, write-offs, and mileage — organized all year, not just in April.',
  },
  {
    lead: 'Your work, everywhere your audience lives.',
    text: 'One tap turns any look into an IG-ready or TikTok-ready export, always credited to you. Grow where you already post.',
  },
  {
    lead: 'Deposits that protect your time.',
    text: 'Booked means booked — deposits, tipping, and refunds handled cleanly.',
  },
]

function FeatureList({ features }: { features: Feature[] }) {
  return (
    <ul className="grid gap-x-16 gap-y-7 md:grid-cols-2">
      {features.map((feature) => (
        <li
          key={feature.lead}
          className="text-[14px] leading-relaxed text-textSecondary"
        >
          <span className="font-bold text-textPrimary">{feature.lead}</span>{' '}
          {feature.text}
        </li>
      ))}
    </ul>
  )
}

export default async function Home() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return (
    <main className="min-h-screen text-textPrimary">

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative flex min-h-screen flex-col overflow-hidden px-6 sm:px-10 lg:px-16">

        {/* Atmospheric glows — no card borders, just depth */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {/* Accent warmth — bottom left */}
          <div className="absolute bottom-[15%] left-[-8%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgb(var(--accent-primary)/0.13),transparent_60%)] blur-3xl" />
          {/* Micro-accent warmth — top right */}
          <div className="absolute right-[-5%] top-[5%] h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgb(var(--micro-accent)/0.09),transparent_65%)] blur-3xl" />
          {/* Subtle grain overlay */}
          <div
            className="absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E\")",
              backgroundRepeat: 'repeat',
              backgroundSize: '128px 128px',
            }}
          />
        </div>

        {/* ── Top bar ──────────────────────────────────────────── */}
        <PublicTopBar className="relative z-10 py-8 px-0 sm:px-0 lg:px-0" />

        {/* ── Center hero ──────────────────────────────────────── */}
        <div className="relative z-10 my-auto flex flex-col gap-8 pb-8 pt-12 sm:pt-8">

          {/* Category marker */}
          <div className="flex items-center gap-3">
            <div className="h-px w-6 bg-accentPrimary" />
            <span className="whitespace-nowrap text-[10px] font-black tracking-[0.22em] text-accentPrimary">
              BEAUTY · BOOKING · REINVENTED
            </span>
          </div>

          {/* Headline — the only large text on this page */}
          <h1 className="font-display text-[52px] font-semibold leading-[1.08] tracking-tight sm:text-[68px] lg:text-[84px] xl:text-[96px]">
            Beauty booking<br />
            <span className="text-textPrimary/50">finally got its upgrade.</span>
          </h1>

          {/* Subtitle */}
          <p className="max-w-sm text-[14px] leading-relaxed text-textSecondary sm:max-w-md sm:text-[15px]">
            Rides, food, flights, banking — everything in your life got smarter.
            Booking a beauty pro? Still phone tag, “text me a picture,” and a
            paper card file. {brand.displayName} brings the chair into the
            modern world — a feed of real looks from real pros near you, where
            every look is bookable.
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/signup/client"
              className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-7 py-3 text-[13px] font-bold text-textPrimary shadow-[0_0_32px_rgb(var(--accent-primary)/0.30)] transition hover:bg-accentPrimaryHover hover:shadow-[0_0_44px_rgb(var(--accent-primary-hover)/0.42)] active:scale-[0.98]"
            >
              Find your look
            </Link>

            <Link
              href="/signup/pro"
              className="inline-flex items-center justify-center rounded-full border border-textPrimary/25 px-7 py-3 text-[13px] font-bold text-textPrimary/80 transition hover:border-textPrimary/40 hover:bg-textPrimary/6 active:scale-[0.98]"
            >
              I&apos;m a professional
            </Link>
          </div>

          {/* Tertiary link */}
          <Link
            href="/looks"
            className="text-[12px] font-medium text-textSecondary/40 underline-offset-3 transition hover:text-textSecondary"
          >
            Browse looks without an account →
          </Link>
        </div>

        {/* Scroll nudge */}
        <div className="relative z-10 flex justify-start pb-10">
          <div className="h-10 w-px bg-gradient-to-b from-textPrimary/15 to-transparent" />
        </div>
      </section>

      {/* ── Clients ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-10 lg:px-16">

        <div className="mb-3 text-[10px] font-black tracking-[0.20em] text-accentPrimary">
          CLIENTS
        </div>
        <h2 className="font-display mb-8 text-[26px] font-semibold leading-tight">
          Shop the look, not the service list.
        </h2>

        <FeatureList features={clientFeatures} />
      </section>

      {/* ── Professionals ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 pb-24 sm:px-10 lg:px-16">

        <div className="mb-3 text-[10px] font-black tracking-[0.20em] text-microAccent/70">
          PROFESSIONALS
        </div>
        <h2 className="font-display mb-8 text-[26px] font-semibold leading-tight">
          Run the chair. We&apos;ll run everything else.
        </h2>

        <FeatureList features={proFeatures} />
      </section>

      {/* ── Footer strip ─────────────────────────────────────────── */}
      <footer className="border-t border-textPrimary/8 px-6 py-8 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-start justify-between gap-6 text-[12px] text-textSecondary/50">
            <div>
              <div className="mb-1 font-black tracking-[0.20em] text-textSecondary/30">{brand.assets.wordmark.text}</div>
              <div className="flex flex-wrap gap-4">
                {[...footerLinks, { href: '/faq', label: 'FAQ' }].map((link) => (
                  <Link key={link.href} href={link.href} className="transition hover:text-textSecondary">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <details className="max-w-xs">
              <summary className="cursor-pointer select-none font-medium text-textSecondary/40 transition hover:text-textSecondary/70">
                SMS policy ↓
              </summary>
              <p className="mt-2 leading-relaxed">
                {buildTransactionalSmsPageCopy(brand.displayName)}
              </p>
            </details>
          </div>
        </div>
      </footer>

    </main>
  )
}