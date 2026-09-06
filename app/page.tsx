// app/page.tsx
//
// The public homepage. Like /why, this is CHECKABLE marketing: every feature
// it names comes from lib/brand/defaultHomeCopy.ts with a state ('live' or
// 'rolling-out') and an evidence line, and the SoftwareApplication JSON-LD
// lists only the live ones. The page renders the copy; it never invents a
// claim of its own.
//
// Shape: one scroll, everything a visitor needs. A hero, a four-beat
// manifesto band, the loop as a numbered column, what one account replaces,
// two audience columns, the money on its own tinted band, and a dated
// "what's next". Rhythm comes from alternating full-bleed bands with quiet
// measure-width sections, not from cards.
import Link from 'next/link'
import { buildTransactionalSmsPageCopy } from '@/lib/transactionalSmsPolicy'
import JsonLdScript from '@/app/_components/seo/JsonLdScript'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import type { BrandHomeCopy, BrandHomeFeature, BrandHomeFeatureState } from '@/lib/brand/types'
import { absoluteUrl } from '@/lib/seo/absoluteUrl'
import { buildHomeJsonLd } from '@/lib/seo/homeJsonLd'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const dynamic = 'force-dynamic'

const footerLinks = [
  { href: '/why', label: 'Why' },
  { href: '/about', label: 'About' },
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/faq', label: 'FAQ' },
] as const

// Tone tokens only; a raw colour here would be blind to one mode.
const CHIP_CLASS: Record<BrandHomeFeatureState, string> = {
  live: 'border-toneSuccess/30 bg-toneSuccess/10 text-toneSuccess',
  'rolling-out': 'border-tonePending/30 bg-tonePending/10 text-tonePending',
}

const SECTION = 'mx-auto max-w-5xl px-6 sm:px-10 lg:px-16'

function StateChip({
  state,
  legend,
}: {
  state: BrandHomeFeatureState
  legend: BrandHomeCopy['legend']
}) {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em]',
        CHIP_CLASS[state],
      ].join(' ')}
    >
      {state === 'live' ? legend.live : legend.rollingOut}
    </span>
  )
}

function FeatureRow({
  feature,
  legend,
}: {
  feature: BrandHomeFeature
  legend: BrandHomeCopy['legend']
}) {
  return (
    <li className="py-6">
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <h3 className="font-display text-[19px] font-semibold leading-tight text-textPrimary">
          {feature.title}
        </h3>
        <StateChip state={feature.state} legend={legend} />
      </div>
      <p className="max-w-[60ch] text-[14px] leading-relaxed text-textSecondary">{feature.body}</p>
    </li>
  )
}

export default async function Home() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = brand.home
  const lastBeat = copy.manifesto.length - 1

  return (
    <main className="min-h-screen text-textPrimary">
      <JsonLdScript
        data={buildHomeJsonLd({ brandDisplayName: brand.displayName, url: absoluteUrl('/'), copy })}
      />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative flex min-h-screen flex-col overflow-hidden px-6 sm:px-10 lg:px-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute bottom-[15%] left-[-8%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgb(var(--accent-primary)/0.13),transparent_60%)] blur-3xl" />
          <div className="absolute right-[-5%] top-[5%] h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgb(var(--micro-accent)/0.09),transparent_65%)] blur-3xl" />
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

        <PublicTopBar className="relative z-10 py-8 px-0 sm:px-0 lg:px-0" />

        <div className="relative z-10 my-auto flex flex-col gap-8 pb-8 pt-12 sm:pt-8">
          <div className="flex items-center gap-3">
            <div className="h-px w-6 bg-accentPrimary" />
            <span className="whitespace-nowrap text-[10px] font-black tracking-[0.22em] text-accentPrimary">
              {copy.hero.eyebrow}
            </span>
          </div>

          <h1 className="font-display text-[52px] font-semibold leading-[1.08] tracking-tight sm:text-[68px] lg:text-[84px] xl:text-[96px]">
            {copy.hero.headlineTop}<br />
            <span className="text-textPrimary/50">{copy.hero.headlineBottom}</span>
          </h1>

          <p className="max-w-sm text-[15px] leading-relaxed text-textSecondary sm:max-w-md sm:text-[17px]">
            {copy.hero.intro}
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/signup/client"
              className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-7 py-3 text-[13px] font-bold text-textPrimary shadow-[0_0_32px_rgb(var(--accent-primary)/0.30)] transition hover:bg-accentPrimaryHover hover:shadow-[0_0_44px_rgb(var(--accent-primary-hover)/0.42)] active:scale-[0.98]"
            >
              {copy.hero.ctaClient}
            </Link>
            <Link
              href="/signup/pro"
              className="inline-flex items-center justify-center rounded-full border border-textPrimary/25 px-7 py-3 text-[13px] font-bold text-textPrimary/80 transition hover:border-textPrimary/40 hover:bg-textPrimary/6 active:scale-[0.98]"
            >
              {copy.hero.ctaPro}
            </Link>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link
              href="/looks"
              className="text-[12px] font-medium text-textSecondary/40 underline-offset-3 transition hover:text-textSecondary"
            >
              {copy.hero.ctaBrowse}
            </Link>
            <Link
              href="/why"
              className="text-[12px] font-medium text-textSecondary/40 underline-offset-3 transition hover:text-textSecondary"
            >
              {copy.hero.ctaWhy}
            </Link>
          </div>
        </div>

        <div className="relative z-10 flex justify-start pb-10">
          <div className="h-10 w-px bg-gradient-to-b from-textPrimary/15 to-transparent" />
        </div>
      </section>

      {/* ── Manifesto band ───────────────────────────────────────── */}
      <section aria-label={copy.manifesto.join(' ')} className="bg-accentPrimary/12 py-14 sm:py-20">
        <div className={SECTION}>
          <p className="font-display flex flex-wrap gap-x-[0.35em] gap-y-1 text-[40px] font-semibold leading-[1.02] tracking-tight sm:text-[64px] lg:text-[88px]">
            {copy.manifesto.map((beat, index) => (
              <span key={beat} className={index === lastBeat ? 'text-accentPrimary' : undefined}>
                {beat}
              </span>
            ))}
          </p>
        </div>
      </section>

      {/* ── The loop ─────────────────────────────────────────────── */}
      <section className={`${SECTION} pb-24 pt-20`}>
        <div className="tovis-section-label mb-6">{copy.loop.label}</div>
        <div className="grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <h2 className="font-display text-[34px] font-semibold leading-[1.05] tracking-tight sm:text-[44px]">
              {copy.loop.title}
            </h2>
            <p className="mt-6 max-w-[48ch] text-[13px] leading-relaxed text-textSecondary">
              {copy.legend.body}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <StateChip state="live" legend={copy.legend} />
              <StateChip state="rolling-out" legend={copy.legend} />
            </div>
          </div>

          <ol className="divide-y divide-textPrimary/10">
            {copy.loop.steps.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 py-8 first:pt-0 last:pb-0">
                <span className="font-display pt-1 text-[28px] font-semibold leading-none text-accentPrimary">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2.5">
                    <h3 className="font-display text-[26px] font-semibold leading-tight">{step.title}</h3>
                    <StateChip state={step.state} legend={copy.legend} />
                  </div>
                  <p className="max-w-[60ch] text-[15px] leading-relaxed text-textSecondary">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── One account replaces ─────────────────────────────────── */}
      <section className="border-y border-textPrimary/8 bg-textPrimary/[0.03] py-20">
        <div className={SECTION}>
          <div className="tovis-section-label mb-6">{copy.replaces.label}</div>
          <div className="grid gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <h2 className="font-display text-[34px] font-semibold leading-[1.05] tracking-tight sm:text-[44px]">
                {copy.replaces.title}
              </h2>
              <p className="mt-5 max-w-[44ch] text-[14px] leading-relaxed text-textSecondary">
                {copy.replaces.body}
              </p>
            </div>
            <dl className="divide-y divide-textPrimary/10">
              {copy.replaces.items.map((item) => (
                <div key={item.tool} className="grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <dt className="text-[13px] font-semibold uppercase tracking-[0.08em] text-textSecondary/60">
                    {item.tool}
                  </dt>
                  <dd className="text-[15px] font-medium leading-snug text-textPrimary">{item.withWhat}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ── Who it's for ─────────────────────────────────────────── */}
      <section className={`${SECTION} py-24`}>
        <div className="tovis-section-label mb-12">Who {brand.displayName} is for</div>

        <div className="grid gap-x-20 gap-y-20 md:grid-cols-2">
          <div>
            <div className="mb-3 text-[10px] font-black tracking-[0.20em] text-accentPrimary">
              {copy.clients.label.toUpperCase()}
            </div>
            <h2 className="font-display text-[34px] font-semibold leading-[1.05] tracking-tight">{copy.clients.title}</h2>
            <ul className="mt-4 divide-y divide-textPrimary/8">
              {copy.clients.features.map((feature) => (
                <FeatureRow key={feature.title} feature={feature} legend={copy.legend} />
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-3 text-[10px] font-black tracking-[0.20em] text-microAccent/70">
              {copy.pros.label.toUpperCase()}
            </div>
            <h2 className="font-display text-[34px] font-semibold leading-[1.05] tracking-tight">{copy.pros.title}</h2>
            <ul className="mt-4 divide-y divide-textPrimary/8">
              {copy.pros.features.map((feature) => (
                <FeatureRow key={feature.title} feature={feature} legend={copy.legend} />
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── The money ────────────────────────────────────────────── */}
      <section className="bg-microAccent/10 py-20">
        <div className={SECTION}>
          <div className="tovis-section-label mb-6">{copy.money.label}</div>
          <div className="grid gap-x-16 gap-y-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="flex flex-wrap items-start gap-3">
              <h2 className="font-display text-[40px] font-semibold leading-[1.02] tracking-tight sm:text-[56px]">
                {copy.money.title}
              </h2>
              <StateChip state={copy.money.state} legend={copy.legend} />
            </div>
            <div>
              <p className="text-[15px] leading-relaxed text-textSecondary sm:text-[16px]">{copy.money.body}</p>
              <Link
                href="/why"
                className="mt-5 inline-block text-[13px] font-bold text-textPrimary underline decoration-microAccent decoration-2 underline-offset-4 transition hover:decoration-textPrimary"
              >
                {copy.money.cta}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── What's next ──────────────────────────────────────────── */}
      <section className={`${SECTION} py-24`}>
        <div className="tovis-section-label mb-6">{copy.next.label}</div>
        <div className="max-w-2xl">
          <h2 className="font-display text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">
            {copy.next.title}
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-textSecondary">{copy.next.body}</p>
          <p className="mt-5 text-[12px] text-textSecondary/60">
            {copy.next.verifiedPrefix}{' '}
            <time dateTime={copy.verifiedOn}>{copy.verifiedOnLabel}</time>.
          </p>
        </div>
      </section>

      {/* ── Footer strip ─────────────────────────────────────────── */}
      <footer className="border-t border-textPrimary/8 px-6 py-8 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-start justify-between gap-6 text-[12px] text-textSecondary/50">
            <div>
              <div className="mb-1 font-black tracking-[0.20em] text-textSecondary/30">{brand.assets.wordmark.text}</div>
              <div className="flex flex-wrap gap-4">
                {footerLinks.map((link) => (
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
