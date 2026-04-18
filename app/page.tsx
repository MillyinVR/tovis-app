// app/page.tsx
import Link from 'next/link'
import { TRANSACTIONAL_SMS_PAGE_COPY } from '@/lib/transactionalSmsPolicy'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandConfig } from '@/lib/brand'

export const dynamic = 'force-dynamic'

const footerLinks = [
  { href: '/about', label: 'About' },
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
] as const

export default function Home() {
  const brand = getBrandConfig()

  return (
    <main className="min-h-screen text-textPrimary">

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative flex min-h-screen flex-col overflow-hidden px-6 sm:px-10 lg:px-16">

        {/* Atmospheric glows — no card borders, just depth */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {/* Terra warmth — bottom left */}
          <div className="absolute bottom-[15%] left-[-8%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgb(196_103_58/0.13),transparent_60%)] blur-3xl" />
          {/* Driftwood warmth — top right */}
          <div className="absolute right-[-5%] top-[5%] h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgb(154_123_92/0.09),transparent_65%)] blur-3xl" />
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
              BEAUTY · BOOKING
            </span>
          </div>

          {/* Headline — the only large text on this page */}
          <h1 className="font-display text-[52px] font-semibold leading-[1.08] tracking-tight sm:text-[68px] lg:text-[84px] xl:text-[96px]">
            A New Age<br />
            <span className="text-textPrimary/50">of Self Care</span>
          </h1>

          {/* Subtitle */}
          <p className="max-w-sm text-[14px] leading-relaxed text-textSecondary sm:max-w-md sm:text-[15px]">
            Booking and client management for beauty professionals —
            with a seamless experience for clients to discover looks and book appointments.
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/signup/client"
              className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-7 py-3 text-[13px] font-bold text-[#F2EDE7] shadow-[0_0_32px_rgb(196_103_58/0.30)] transition hover:bg-accentPrimaryHover hover:shadow-[0_0_44px_rgb(196_103_58/0.42)] active:scale-[0.98]"
            >
              Create Client Account
            </Link>

            <Link
              href="/signup/pro"
              className="inline-flex items-center justify-center rounded-full border border-textPrimary/25 px-7 py-3 text-[13px] font-bold text-textPrimary/80 transition hover:border-textPrimary/40 hover:bg-textPrimary/6 active:scale-[0.98]"
            >
              I'm a professional
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

      {/* ── Who it's for ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 pb-24 sm:px-10 lg:px-16">

        <div className="tovis-section-label mb-10">Who {brand.displayName} is for</div>

        <div className="grid gap-x-16 gap-y-10 md:grid-cols-2">
          <div>
            <div className="mb-3 text-[10px] font-black tracking-[0.20em] text-accentPrimary">
              CLIENTS
            </div>
            <h2 className="font-display mb-3 text-[26px] font-semibold leading-tight">
              Find your perfect look
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              Discover beauty professionals near you, explore curated looks,
              and manage all your appointments in one place.
            </p>
          </div>

          <div>
            <div className="mb-3 text-[10px] font-black tracking-[0.20em] text-microAccent/70">
              PROFESSIONALS
            </div>
            <h2 className="font-display mb-3 text-[26px] font-semibold leading-tight">
              Run your business
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              Manage services, handle bookings, build your portfolio, and grow your
              client base — from one clean dashboard.
            </p>
          </div>
        </div>
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
                {TRANSACTIONAL_SMS_PAGE_COPY}
              </p>
            </details>
          </div>
        </div>
      </footer>

    </main>
  )
}
