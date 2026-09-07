import EditorialHome from './_components/home/EditorialHome'
import './styles/editorial-home.css'
// Public homepage: tenant copy, explicit editorial placeholders, and gated feature claims.
import { Fragment } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { buildTransactionalSmsPageCopy } from '@/lib/transactionalSmsPolicy'
import JsonLdScript from '@/app/_components/seo/JsonLdScript'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import CardPreview from '@/app/_components/home/CardPreview'
import HomeMotion from '@/app/_components/home/HomeMotion'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import type {
  BrandHomeCopy,
  BrandHomeFeature,
  BrandHomeFeatureState,
  BrandHomeSpotlightFeature,
} from '@/lib/brand/types'
import { absoluteUrl } from '@/lib/seo/absoluteUrl'
import { buildHomeJsonLd } from '@/lib/seo/homeJsonLd'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import {
  HOMEPAGE_PROOF_CAPTION,
  homepageSocialProof,
  type HomepageProofTone,
} from '@/lib/homepage/socialProof'

export const dynamic = 'force-dynamic'

/** The hero is the cursor glow's positioning context; HomeMotion needs its id. */
const HERO_ID = 'tv-hero'

const SECTION = 'mx-auto max-w-[1240px] px-[clamp(20px,5vw,72px)]'

const topBarLinks = [
  { href: '#clients', label: 'Clients' },
  { href: '#pros', label: 'Pros' },
  { href: '#loop', label: 'How it works' },
] as const

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

const proofToneClass: Record<HomepageProofTone, string> = {
  paper: 'text-textPrimary',
  teal: 'text-accentPrimary',
  gold: 'text-microAccent',
  iris: 'text-iris',
}

/** Small-caps mono eyebrow — the artboard's recurring section marker. */
function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={[
        'font-mono text-[11px] font-bold uppercase tracking-[0.2em]',
        className ?? 'text-textMuted',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

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

/**
 * The artboard's numbered rows, carrying the state chip. Clients and pros share
 * the shape and differ only in which accent the index and the hover wash use,
 * so the variants are two fixed class strings rather than two copies of the
 * markup.
 */
function FeatureRows({
  features,
  legend,
  tone,
}: {
  features: BrandHomeFeature[]
  legend: BrandHomeCopy['legend']
  tone: 'teal' | 'gold'
}) {
  const indexClass = tone === 'teal' ? 'text-accentPrimary/70' : 'text-microAccent/75'
  const hoverClass =
    tone === 'teal' ? 'hover:bg-accentPrimary/[0.06]' : 'hover:bg-microAccent/[0.06]'

  return (
    <ul className="flex flex-col gap-0.5">
      {features.map((feature, index) => (
        <li
          key={feature.title}
          className={[
            'tv-reveal rounded-[14px] border-t border-surfaceGlass/10 px-[18px] py-6 transition-colors',
            hoverClass,
            index === features.length - 1 ? 'border-b border-surfaceGlass/10' : '',
          ].join(' ')}
        >
          <div className="flex items-baseline gap-4">
            <span className={['flex-none font-mono text-[11px]', indexClass].join(' ')}>
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <div className="mb-[7px] flex flex-wrap items-center gap-2.5">
                <h3 className="font-display text-[clamp(17px,1.7vw,22px)] font-bold tracking-[-0.03em] text-textPrimary">
                  {feature.title}
                </h3>
                <StateChip state={feature.state} legend={legend} />
              </div>
              <p className="m-0 max-w-[60ch] text-[14.5px] leading-[1.6] text-textSecondary">
                {feature.body}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** One spotlight card. Index picks the accent; the pair alternates teal/gold. */
function SpotlightCard({
  feature,
  legend,
  tone,
  delayClass,
}: {
  feature: BrandHomeSpotlightFeature
  legend: BrandHomeCopy['legend']
  tone: 'teal' | 'gold'
  delayClass?: string
}) {
  const teal = tone === 'teal'
  return (
    <div
      className={[
        'tv-reveal flex flex-col rounded-[22px] border border-surfaceGlass/10 p-[clamp(26px,3vw,40px)] transition-colors',
        teal
          ? 'bg-[linear-gradient(165deg,rgb(var(--accent-primary)/0.08),transparent)] hover:border-accentPrimary/45 hover:bg-[linear-gradient(165deg,rgb(var(--accent-primary)/0.14),transparent)]'
          : 'bg-[linear-gradient(165deg,rgb(var(--micro-accent)/0.09),transparent)] hover:border-microAccent/45 hover:bg-[linear-gradient(165deg,rgb(var(--micro-accent)/0.15),transparent)]',
        delayClass ?? '',
      ].join(' ')}
    >
      <div className="mb-[22px] flex flex-wrap items-center gap-2.5">
        <span
          className={[
            'tv-pulse h-[7px] w-[7px] shrink-0 rounded-full',
            teal ? 'bg-accentPrimary' : 'bg-microAccent',
          ].join(' ')}
        />
        <Eyebrow
          className={[
            'tracking-[0.18em]',
            teal ? 'text-accentPrimary' : 'text-microAccent',
          ].join(' ')}
        >
          {feature.eyebrow}
        </Eyebrow>
        <StateChip state={feature.state} legend={legend} />
      </div>

      <h3 className="mb-3.5 text-balance font-display text-[clamp(22px,2.4vw,32px)] font-bold leading-[1.08] tracking-[-0.04em] text-textPrimary">
        {feature.title}
      </h3>
      <p className="mb-[18px] mt-0 text-[15px] leading-[1.62] text-textSecondary">
        {feature.body}
      </p>
      <p className="mb-[26px] mt-0 text-[15px] leading-[1.62] text-textMuted">{feature.aside}</p>

      <div className="mt-auto flex flex-wrap gap-2">
        {feature.chips.map((chip, index) => (
          <span
            key={chip}
            className={[
              'rounded-[18px] border px-[11px] py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-textPrimary/90',
              index === 0
                ? teal
                  ? 'border-accentPrimary/35 bg-accentPrimary/[0.07]'
                  : 'border-microAccent/40 bg-microAccent/[0.08]'
                : 'border-surfaceGlass/15',
            ].join(' ')}
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The two primary calls to action, shared by the hero and the closer. */
function CallsToAction({
  copy,
  centered,
}: {
  copy: BrandHomeCopy['hero']
  centered?: boolean
}) {
  return (
    <div
      className={['flex flex-wrap items-center gap-3', centered ? 'justify-center' : ''].join(' ')}
    >
      <Link
        href="/signup/client"
        className="inline-flex items-center gap-2 rounded-full bg-microAccent px-8 py-4 font-display text-[14px] font-bold text-onAccent shadow-[0_0_38px_rgb(var(--micro-accent)/0.30)] transition hover:-translate-y-0.5 hover:shadow-[0_0_56px_rgb(var(--micro-accent)/0.48)] active:translate-y-0"
      >
        {copy.ctaClient} <span className="font-mono">→</span>
      </Link>
      <Link
        href="/signup/pro"
        className="inline-flex items-center rounded-full border border-surfaceGlass/25 px-8 py-4 font-display text-[14px] font-bold text-textPrimary/85 transition hover:-translate-y-0.5 hover:border-surfaceGlass/50 hover:bg-surfaceGlass/[0.06] active:translate-y-0"
      >
        {copy.ctaPro}
      </Link>
    </div>
  )
}

export default async function Home() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = brand.home
  if (copy.campaign) {
    return (
      <main>
        <JsonLdScript
          data={buildHomeJsonLd({ brandDisplayName: brand.displayName, url: absoluteUrl('/'), copy })}
        />
        <EditorialHome
          copy={copy}
          campaign={copy.campaign}
          navigation={<PublicTopBar links={copy.campaign.nav} />}
          footer={
            <footer className="eh-footer">
              <nav>
                {copy.campaign.footerLinks.map(link => (
                  <Link key={link.href} href={link.href}>{link.label}</Link>
                ))}
              </nav>
              <div>
                <strong>{copy.campaign.smsLabel}</strong>
                <p>{buildTransactionalSmsPageCopy(brand.displayName)}</p>
              </div>
            </footer>
          }
        />
      </main>
    )
  }
  const { stats, voices } = homepageSocialProof()
  const lastBeat = copy.manifesto.length - 1

  return (
    <main className="relative overflow-x-hidden bg-bgPrimary font-sans text-textPrimary">
      <JsonLdScript
        data={buildHomeJsonLd({ brandDisplayName: brand.displayName, url: absoluteUrl('/'), copy })}
      />
      <HomeMotion scopeId={HERO_ID} />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section
        id={HERO_ID}
        className="relative flex flex-col overflow-hidden px-[clamp(20px,5vw,72px)]"
      >
        {/* Atmospheric depth — drifting plume orbs over a film grain. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="tv-drift absolute bottom-[8%] left-[-14%] h-[min(680px,90vw)] w-[min(680px,90vw)] rounded-full bg-[radial-gradient(circle,rgb(var(--accent-primary)/0.22),transparent_62%)] blur-[30px]" />
          <div className="tv-drift-alt absolute right-[-10%] top-[-8%] h-[min(520px,80vw)] w-[min(520px,80vw)] rounded-full bg-[radial-gradient(circle,rgb(var(--micro-accent)/0.16),transparent_65%)] blur-[34px]" />
          <div className="tv-drift-slow absolute left-[38%] top-[28%] h-[min(460px,70vw)] w-[min(460px,70vw)] rounded-full bg-[radial-gradient(circle,rgb(var(--iris)/0.16),transparent_66%)] blur-[40px]" />
          <div className="tv-cursor-glow" />
          <div className="tv-grain absolute inset-0 opacity-[0.035]" />
        </div>

        <PublicTopBar
          links={topBarLinks}
          className="relative z-10 mx-auto w-full max-w-[1240px] px-0 py-[26px] sm:px-0 lg:px-0"
        />

        <div className="relative z-10 mx-auto grid w-full max-w-[1240px] items-center gap-10 pb-12 pt-8 lg:grid-cols-[1fr_1fr] lg:py-16">
          <div className="flex min-w-0 flex-col gap-7">
            <div className="tv-reveal flex items-center gap-3">
              <span className="h-px w-[26px] bg-accentPrimary" />
              <Eyebrow className="whitespace-nowrap text-accentPrimary">{copy.hero.eyebrow}</Eyebrow>
              <span className="tv-pulse h-1.5 w-1.5 rounded-full bg-microAccent" />
            </div>

            {/* The headline arrives word by word (see HomeMotion), with the
                second line in the brand gradient. Splitting on spaces keeps that
                treatment working for whatever copy a tenant supplies.

                🔴 The separator has to sit OUTSIDE the span. `.tv-word` is an
                inline-block so it can be transformed, and a trailing space
                *inside* an inline-block is trimmed at the end of its line box —
                which rendered "Beautybooking" with the words jammed together.
                As a sibling text node it is a real space between two boxes. */}
            <h1 className="m-0 max-w-[18ch] text-balance font-display text-[clamp(48px,6.7vw,96px)] font-bold leading-[0.94] tracking-[-0.05em]">
              {/* Each half is its own block so the copy's own split is the line
                  break. Left to flow, "finally" rode up onto the first line and
                  the gradient started mid-sentence. */}
              <span className="block">
                {copy.hero.headlineTop.split(' ').map((word, index) => (
                  <Fragment key={`top-${index}`}>
                    <span className="tv-word">{word}</span>{' '}
                  </Fragment>
                ))}
              </span>
              <span className="block">
                {copy.hero.headlineBottom.split(' ').map((word, index) => (
                  <Fragment key={`bottom-${index}`}>
                    <span className="tv-word tv-plume-text">{word}</span>{' '}
                  </Fragment>
                ))}
              </span>
            </h1>

            <p className="tv-reveal tv-delay-1 m-0 max-w-[56ch] text-[clamp(15px,1.35vw,19px)] leading-[1.6] text-textSecondary">
              {copy.hero.intro}
            </p>

            <div className="tv-reveal tv-delay-2 flex flex-col gap-4">
              <CallsToAction copy={copy.hero} />
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Link
                  href="/looks"
                  className="text-[13px] font-semibold text-textMuted transition hover:text-textPrimary"
                >
                  {copy.hero.ctaBrowse}
                </Link>
                <Link
                  href="/why"
                  className="text-[13px] font-semibold text-textMuted transition hover:text-textPrimary"
                >
                  {copy.hero.ctaWhy}
                </Link>
              </div>
            </div>
          </div>
          <figure className="m-0 min-w-0">
            <div className="relative aspect-[3/2] overflow-hidden rounded-[24px]">
              <Image src={copy.editorial.heroImage.src} alt={copy.editorial.heroImage.alt} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
            </div>
            <figcaption className="mt-3 text-[11px] leading-relaxed text-textMuted">{copy.editorial.placeholderLabel}</figcaption>
          </figure>
        </div>

        {/* Scroll nudge */}
        <div className="relative z-10 mx-auto flex w-full max-w-[1240px] items-center gap-3 pb-[34px]">
          <span className="tv-scroll-line block h-[46px] w-px bg-gradient-to-b from-surfaceGlass/45 to-transparent" />
          <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-textMuted">
            Scroll
          </span>
        </div>
      </section>

      <section id="discovery" className={`${SECTION} py-16`}>
        <Eyebrow className="text-accentPrimary">{copy.editorial.location}</Eyebrow>
        <div className="mb-8 mt-4 flex flex-wrap items-end justify-between gap-5">
          <h2 className="max-w-[20ch] font-display text-[clamp(36px,4.6vw,64px)] font-bold leading-[1.02] tracking-[-0.04em]">{copy.editorial.discoveryTitle}</h2>
          <Link href="/looks" className="text-sm font-semibold underline underline-offset-4">{copy.hero.ctaBrowse}</Link>
        </div>
        <div className="mb-8 flex flex-wrap gap-2" aria-label="Editorial inspiration categories">
          {copy.editorial.categories.map((category) => (
            <span key={category} className="rounded-full border border-surfaceGlass/20 px-4 py-2 text-sm text-textSecondary">{category}</span>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          {copy.editorial.looks.map((look) => (
            <figure key={look.src} className="m-0">
            <div className="relative aspect-[3/4] overflow-hidden rounded-[18px] bg-surfaceGlass/5">
              <Image src={look.src} alt={look.alt} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
            </div>
            <figcaption className="mt-3 font-display text-xl">{look.label}</figcaption>
          </figure>
          ))}
        </div>
        <p className="mt-5 text-xs leading-relaxed text-textMuted">{copy.editorial.placeholderLabel}</p>
      </section>

      {/* ── Manifesto band ────────────────────────────────────────── */}
      <section
        aria-label={copy.manifesto.join(' ')}
        className="border-b border-surfaceGlass/10 bg-accentPrimary/[0.08] py-[clamp(44px,7vw,80px)]"
      >
        <div className={SECTION}>
          <p className="tv-reveal m-0 flex flex-wrap gap-x-[0.35em] gap-y-1 font-display text-[clamp(40px,7vw,88px)] font-bold leading-[1.02] tracking-[-0.05em]">
            {copy.manifesto.map((beat, index) => (
              <span key={beat} className={index === lastBeat ? 'text-accentPrimary' : undefined}>
                {beat}
              </span>
            ))}
          </p>
        </div>
      </section>

      {/* ── Proof band ────────────────────────────────────────────────
          Renders only once real, measured figures exist — see
          lib/homepage/socialProof.ts. */}
      {stats.length > 0 && (
        <section className={`${SECTION} py-[clamp(52px,8vw,96px)]`}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[clamp(24px,4vw,48px)]">
            {stats.map((stat) => (
              <div key={stat.label} className="tv-reveal">
                <div
                  className={[
                    'font-display text-[clamp(34px,4vw,54px)] font-bold leading-none tracking-[-0.04em]',
                    proofToneClass[stat.tone],
                  ].join(' ')}
                >
                  {stat.value}
                </div>
                <div className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-textMuted">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
          <div className="tv-reveal tv-delay-3 mt-[26px] text-[12px] text-textMuted">
            {HOMEPAGE_PROOF_CAPTION}
          </div>
        </section>
      )}

      {/* ── The loop ──────────────────────────────────────────────── */}
      <section id="loop" className={`${SECTION} scroll-mt-8 py-[clamp(48px,7vw,90px)]`}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-[clamp(28px,4vw,64px)]">
          <div className="mb-2.5 md:sticky md:top-10 md:mb-0">
            <div className="tv-reveal">
              <Eyebrow className="mb-3.5 text-accentPrimary">{copy.loop.label}</Eyebrow>
              <h2 className="m-0 text-balance font-display text-[clamp(30px,3.6vw,52px)] font-bold leading-[1.02] tracking-[-0.045em]">
                {copy.loop.title}
              </h2>
              {/* The chips appear here first, beside the two states in use, so
                  a reader meets the vocabulary before it starts labelling rows. */}
              <div className="mt-6 flex items-center gap-2">
                <StateChip state="live" legend={copy.legend} />
                <StateChip state="rolling-out" legend={copy.legend} />
              </div>
            </div>
          </div>

          <FeatureRows features={copy.loop.steps} legend={copy.legend} tone="teal" />
        </div>
      </section>

      {/* ── Spotlight ─────────────────────────────────────────────── */}
      <section className={`relative overflow-hidden ${SECTION} py-[clamp(52px,8vw,110px)]`}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="tv-drift absolute right-[-12%] top-[10%] h-[min(560px,85vw)] w-[min(560px,85vw)] rounded-full bg-[radial-gradient(circle,rgb(var(--accent-primary)/0.13),transparent_64%)] blur-[36px]" />
        </div>

        <div className="tv-reveal relative mb-[clamp(32px,5vw,58px)]">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px w-[26px] bg-iris" />
            <Eyebrow>{copy.spotlight.label}</Eyebrow>
          </div>
          <h2 className="m-0 max-w-[24ch] text-balance font-display text-[clamp(32px,4.6vw,66px)] font-bold leading-none tracking-[-0.048em]">
            {copy.spotlight.title}{' '}
            <span className="tv-plume-text">{copy.spotlight.titleAccent}</span>
          </h2>
        </div>

        <ol className="mb-8 grid gap-6 md:grid-cols-3">
          {copy.editorial.journey.map((step, index) => (
            <li key={step.title} className="border-t border-accentPrimary/30 pt-5">
            <span className="font-mono text-xs text-accentPrimary">0{index + 1}</span>
            <h3 className="my-3 font-display text-xl font-semibold">{step.title}</h3>
            <p className="text-sm leading-relaxed text-textSecondary">{step.body}</p>
          </li>
          ))}
        </ol>
        <p className="mb-8 max-w-[80ch] text-sm leading-relaxed text-textMuted">{copy.editorial.journeyNote}</p>
        <div className="relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-[clamp(20px,3vw,34px)]">
          {copy.spotlight.features.map((feature, index) => (
            <SpotlightCard
              key={feature.title}
              feature={feature}
              legend={copy.legend}
              tone={index % 2 === 0 ? 'teal' : 'gold'}
              delayClass={index === 1 ? 'tv-delay-1' : undefined}
            />
          ))}
        </div>
      </section>

      {/* ── Clients ───────────────────────────────────────────────── */}
      <section id="clients" className={`${SECTION} scroll-mt-8 py-[clamp(48px,7vw,90px)]`}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-[clamp(28px,4vw,64px)]">
          <div className="mb-2.5 md:sticky md:top-10 md:mb-0">
            <div className="tv-reveal">
              <Eyebrow className="mb-3.5 text-accentPrimary">{copy.clients.label}</Eyebrow>
              <h2 className="m-0 text-balance font-display text-[clamp(30px,3.6vw,52px)] font-bold leading-[1.02] tracking-[-0.045em]">
                {copy.editorial.trustTitle}
              </h2>
              <p className="mb-0 mt-[18px] max-w-[38ch] text-[15px] leading-[1.6] text-textMuted">
                {copy.editorial.trustBody}
              </p>
            </div>
          </div>

          <FeatureRows features={copy.clients.features.slice(0, 2)} legend={copy.legend} tone="teal" />
        </div>
      </section>

      {/* ── The chart ─────────────────────────────────────────────────
          The one row on the page that compounds, so it gets a band rather
          than a line in a list. The consent rule sits in the same band as the
          benefit on purpose: this is the section where a reader decides
          whether the accumulating history is a good thing. */}
      <section className="border-y border-surfaceGlass/10 bg-[linear-gradient(160deg,rgb(var(--iris)/0.07),rgb(var(--accent-primary)/0.05))]">
        <div className={`${SECTION} py-[clamp(48px,7vw,90px)]`}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-[clamp(28px,4vw,64px)]">
            <div className="tv-reveal">
              <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
                <Eyebrow className="text-iris">{copy.chart.label}</Eyebrow>
                <StateChip state={copy.chart.state} legend={copy.legend} />
              </div>
              <h2 className="m-0 text-balance font-display text-[clamp(30px,3.6vw,52px)] font-bold leading-[1.02] tracking-[-0.045em]">
                {copy.chart.title}{' '}
                <span className="tv-plume-text">{copy.chart.titleAccent}</span>
              </h2>
            </div>

            <div className="tv-reveal tv-delay-1">
              <p className="m-0 max-w-[56ch] text-[15px] leading-[1.62] text-textSecondary sm:text-[16px]">
                {copy.chart.body}
              </p>
              <p className="mb-0 mt-4 max-w-[56ch] text-[14.5px] leading-[1.6] text-textMuted">
                {copy.chart.aside}
              </p>

              <dl className="m-0 mt-8 flex flex-col">
                {copy.chart.points.map((point, index) => (
                  <div
                    key={point.label}
                    className={[
                      'grid gap-x-6 gap-y-1 border-t border-surfaceGlass/10 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]',
                      index === copy.chart.points.length - 1
                        ? 'border-b border-surfaceGlass/10'
                        : '',
                    ].join(' ')}
                  >
                    <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-textMuted">
                      {point.label}
                    </dt>
                    <dd className="m-0 text-[15px] font-medium leading-snug text-textPrimary">
                      {point.body}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* ── Professionals ─────────────────────────────────────────── */}
      <section id="pros" className={`${SECTION} scroll-mt-8 py-[clamp(48px,7vw,90px)]`}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-[clamp(28px,4vw,64px)]">
          <div className="mb-2.5 md:sticky md:top-10 md:mb-0">
            <div className="tv-reveal">
              <Eyebrow className="mb-3.5 text-microAccent">{copy.pros.label}</Eyebrow>
              <h2 className="m-0 text-balance font-display text-[clamp(30px,3.6vw,52px)] font-bold leading-[1.02] tracking-[-0.045em]">
                {copy.pros.title}
              </h2>
              <p className="mb-0 mt-[18px] max-w-[38ch] text-[15px] leading-[1.6] text-textMuted">
                {copy.pros.intro}
              </p>
            </div>
          </div>

          <FeatureRows features={copy.pros.features} legend={copy.legend} tone="gold" />
        </div>
      </section>

      {copy.editorial.progression.length > 0 && (
        <section className="border-y border-microAccent/20 bg-microAccent/[0.05]">
          <div className={`${SECTION} py-16`}>
            <Eyebrow className="text-microAccent">{copy.editorial.upcomingLabel}</Eyebrow>
            <h2 className="mt-5 max-w-[25ch] font-display text-[clamp(32px,4vw,56px)] font-bold leading-tight tracking-[-0.04em]">{copy.editorial.foundingTitle}</h2>
            <p className="mt-5 max-w-[65ch] leading-relaxed text-textSecondary">{copy.editorial.foundingBody}</p>
            {copy.editorial.foundingCard && (
              <div className="mt-6 max-w-[65ch] rounded-[18px] border border-surfaceGlass/20 p-6 text-sm leading-relaxed text-textSecondary">
                <p>{copy.editorial.foundingCard}</p>
                {copy.editorial.foundingPreview && <CardPreview card={copy.editorial.foundingPreview} />}
              </div>
            )}
            <ol className="my-10 grid gap-4 md:grid-cols-3">
              {copy.editorial.progression.map((stage, index) => (
                <li key={stage} className="rounded-[18px] border border-microAccent/25 p-6">
                <span className="font-mono text-xs text-microAccent">0{index + 1}</span>
                <h3 className="mt-5 font-display text-2xl font-semibold">{stage}</h3>
                {copy.editorial.progressionCards[stage] && <CardPreview card={copy.editorial.progressionCards[stage]} />}
              </li>
          ))}
            </ol>
            <p className="mb-7 max-w-[75ch] text-sm leading-relaxed text-textMuted">{copy.editorial.progressionBody}</p>
            <Link href="/signup/pro" className="inline-flex rounded-full border border-microAccent/50 px-6 py-3 font-semibold">{copy.hero.ctaPro} →</Link>
          </div>
        </section>
      )}

      {/* ── The money ─────────────────────────────────────────────── */}
      <section className="border-y border-surfaceGlass/10 bg-microAccent/[0.08]">
        <div className={`${SECTION} py-[clamp(48px,7vw,88px)]`}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-[clamp(28px,4vw,64px)]">
            <div className="tv-reveal">
              <Eyebrow className="mb-3.5 text-microAccent">{copy.money.label}</Eyebrow>
              <div className="flex flex-wrap items-start gap-3">
                <h2 className="m-0 text-balance font-display text-[clamp(30px,3.6vw,52px)] font-bold leading-[1.02] tracking-[-0.045em]">
                  {copy.money.title}
                </h2>
                <StateChip state={copy.money.state} legend={copy.legend} />
              </div>
            </div>
            <div className="tv-reveal tv-delay-1">
              <p className="m-0 max-w-[56ch] text-[15px] leading-[1.62] text-textSecondary sm:text-[16px]">
                {copy.money.body}
              </p>
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

      {/* ── Voices ────────────────────────────────────────────────────
          Renders only once real, attributable quotes exist — see
          lib/homepage/socialProof.ts. */}
      {voices.length > 0 && (
        <section className="border-b border-surfaceGlass/10 bg-surfaceGlass/[0.02]">
          <div className={`${SECTION} py-[clamp(48px,7vw,88px)]`}>
            <Eyebrow className="tv-reveal mb-[34px]">From the chair</Eyebrow>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-[clamp(20px,3vw,32px)]">
              {voices.map((voice, index) => (
                <figure
                  key={voice.attribution}
                  className={[
                    'tv-reveal m-0 rounded-[18px] border border-surfaceGlass/10 p-7 transition-colors hover:border-accentPrimary/40',
                    index === 1 ? 'tv-delay-1' : index === 2 ? 'tv-delay-2' : '',
                  ].join(' ')}
                >
                  <blockquote className="m-0 mb-5 font-display text-[18px] leading-[1.45] tracking-[-0.02em] text-textPrimary">
                    “{voice.quote}”
                  </blockquote>
                  <figcaption className="font-mono text-[11px] uppercase tracking-[0.14em] text-textMuted">
                    {voice.attribution}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── What's next ───────────────────────────────────────────── */}
      <section className={`${SECTION} py-[clamp(48px,7vw,90px)]`}>
        <div className="tv-reveal max-w-2xl">
          <Eyebrow className="mb-3.5">{copy.next.label}</Eyebrow>
          <h2 className="m-0 text-balance font-display text-[clamp(26px,3vw,38px)] font-bold leading-tight tracking-[-0.04em]">
            {copy.next.title}
          </h2>
          <p className="mt-4 text-[15px] leading-[1.6] text-textSecondary">{copy.next.body}</p>
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-textMuted">
            {copy.next.verifiedPrefix}{' '}
            <time dateTime={copy.verifiedOn}>{copy.verifiedOnLabel}</time>.
          </p>
        </div>
      </section>

      {/* ── Closer ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-surfaceGlass/10">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="tv-drift-alt absolute bottom-[-40%] left-[20%] h-[min(760px,110vw)] w-[min(760px,110vw)] rounded-full bg-[radial-gradient(circle,rgb(var(--iris)/0.20),transparent_62%)] blur-[40px]" />
        </div>
        <div
          className={`relative ${SECTION} py-[clamp(64px,10vw,130px)] text-center`}
        >
          <h2 className="tv-reveal mx-auto max-w-[20ch] text-balance font-display text-[clamp(34px,6vw,84px)] font-bold leading-[0.98] tracking-[-0.05em]">
            {copy.closer.title}{' '}
            <span className="tv-plume-text">{copy.closer.titleAccent}</span>
          </h2>
          <div className="tv-reveal tv-delay-1 mt-[38px]">
            <CallsToAction copy={copy.hero} centered />
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="border-t border-surfaceGlass/10 px-[clamp(20px,5vw,72px)] py-[clamp(28px,4vw,44px)]">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-start justify-between gap-7">
          <div>
            <Eyebrow className="mb-3">{brand.assets.wordmark.text}</Eyebrow>
            <div className="flex flex-wrap gap-[18px]">
              {footerLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-[13px] text-textSecondary/60 transition hover:text-textPrimary"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="max-w-[46ch]">
            <Eyebrow className="mb-2.5 tracking-[0.16em]">SMS policy</Eyebrow>
            <p className="m-0 text-[12.5px] leading-[1.6] text-textMuted">
              {buildTransactionalSmsPageCopy(brand.displayName)}
            </p>
          </div>
        </div>
      </footer>
    </main>
  )
}
