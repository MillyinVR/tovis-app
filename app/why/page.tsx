// app/why/page.tsx
//
// The fee-story page: the platform's biggest verifiable differentiator
// (no commissions, non-custodial payouts) told plainly, with FAQPage
// structured data so search and AI answer engines can cite it. Every claim
// here must stay TRUE against the payments code — this page is marketing,
// but it is checkable marketing.
import type { Metadata } from 'next'
import Link from 'next/link'

import JsonLdScript from '@/app/_components/seo/JsonLdScript'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { buildFaqJsonLd, type FaqItem } from '@/lib/seo/faqJsonLd'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const dynamic = 'force-dynamic'

function buildFaqItems(brandName: string): FaqItem[] {
  return [
    {
      question: `Do professionals pay commissions on ${brandName}?`,
      answer:
        `No. Professionals keep 100% of every service payment, minus standard card processing. ${brandName} charges no percentage, no per-booking fee, and no "new client" commission to professionals — ever.`,
    },
    {
      question: 'Who pays the discovery fee?',
      answer:
        `The client — not the professional. When a brand-new client finds a professional through ${brandName}'s discovery surfaces, they pay a small one-time fee on their first booking. That is the platform's only booking-related charge.`,
    },
    {
      question: 'Can the platform hold or delay payouts?',
      answer:
        `No. Payments settle directly to the professional's own Stripe account — ${brandName} never holds the money, so there is nothing to withhold or delay.`,
    },
    {
      question: 'Do clients pay booking fees?',
      answer:
        'No. Booking, rescheduling, and messaging are free for clients. The only client-side charge is the one-time discovery fee on some first-time matches.',
    },
    {
      question: `What does ${brandName} cost a professional?`,
      answer:
        'Taking bookings and getting paid is free — no subscription required for the essentials: online booking, calendar, client records, reminders, and payments. An optional membership adds business extras.',
    },
  ]
}

export async function generateMetadata(): Promise<Metadata> {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return {
    title: `Why ${brand.displayName} — no commissions, no held payouts`,
    description: `${brand.displayName} charges professionals no commissions and never holds their payouts. Here is exactly how the money works.`,
    alternates: { canonical: '/why' },
  }
}

export default async function WhyPage() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const faqItems = buildFaqItems(brand.displayName)

  return (
    <main className="min-h-screen w-full text-textPrimary">
      <JsonLdScript data={buildFaqJsonLd(faqItems)} />
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">
        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">Why {brand.displayName}</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            Keep every dollar you earn.
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
            Most booking platforms take a cut — commissions on new clients,
            per-booking fees, marketplace percentages, payouts held for days.{' '}
            {brand.displayName} is built the other way around. Here is exactly
            how the money works.
          </p>
        </header>

        <div className="grid divide-y divide-textPrimary/8">
          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black uppercase tracking-[0.14em] text-textSecondary/60">
              No commissions, ever
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              Professionals keep 100% of every service payment, minus standard
              card processing. No percentage taken, no per-booking fee, and no
              &ldquo;new client&rdquo; commission — including for clients who
              find you here.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black uppercase tracking-[0.14em] text-textSecondary/60">
              Your money never touches our hands
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              Payments settle directly into your own Stripe account.{' '}
              {brand.displayName} is non-custodial by design: we never hold
              your balance, so a withheld or delayed payout is structurally
              impossible — not just against policy.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black uppercase tracking-[0.14em] text-textSecondary/60">
              One small, honest fee
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              When a brand-new client discovers you through{' '}
              {brand.displayName}, they pay a small one-time discovery fee on
              that first booking — the client pays it, not you, and it never
              repeats. That is the platform&rsquo;s only booking-related
              charge.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black uppercase tracking-[0.14em] text-textSecondary/60">
              The essentials are never paywalled
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              Online booking, your calendar, client records, reminders, and
              getting paid — free, from day one. An optional membership adds
              business extras, but your ability to earn is never gated.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-4 text-[12px] font-black uppercase tracking-[0.14em] text-textSecondary/60">
              Common questions
            </h2>
            <div className="grid gap-5">
              {faqItems.map((item) => (
                <div key={item.question}>
                  <h3 className="text-[14px] font-semibold text-textPrimary">
                    {item.question}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-wrap gap-3 py-8">
            <Link
              href="/signup"
              className="inline-flex items-center rounded-full bg-accentPrimary px-6 py-3 text-[14px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
            >
              Get started
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center rounded-full border border-textPrimary/16 px-6 py-3 text-[14px] font-black text-textSecondary transition hover:border-textPrimary/30 hover:text-textPrimary"
            >
              Find your pro
            </Link>
          </section>
        </div>
      </div>
    </main>
  )
}
