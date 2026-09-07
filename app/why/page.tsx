import type { Metadata } from 'next'
import Link from 'next/link'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { marketingPricing } from '@/lib/brand/marketingPricing'
import { platformFeesEnabled } from '@/lib/booking/discoveryFee'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = marketingPricing(platformFeesEnabled())
  return {
    title: `${brand.displayName} — ${copy.title}`,
    description: copy.commission,
    alternates: { canonical: '/why' },
  }
}

export default async function WhyPage() {
  const tenant = await resolveTenantContextForLayout()
  const brand = getBrandForTenantContext(tenant)
  const copy = marketingPricing(platformFeesEnabled())
  const seo = tenant.isRoot ? brand.home.campaign?.seo : undefined
  return (
    <main className="min-h-screen bg-bgPrimary text-textPrimary">
      <PublicTopBar />
      <article className="mx-auto max-w-2xl px-6 pb-20">
        <h1 className="mt-8 font-display text-4xl font-semibold leading-tight">
          {copy.title}
        </h1>
        {[
          copy.commission,
          copy.subscription,
          copy.professional,
          copy.client,
          copy.scope,
          copy.processing,
          copy.payout,
        ].map((paragraph) => (
          <p
            key={paragraph}
            className="border-b border-surfaceGlass/15 py-6 leading-relaxed text-textSecondary"
          >
            {paragraph}
          </p>
        ))}
        {seo && (
          <aside className="mt-8 rounded-xl border border-surfaceGlass/20 p-6">
            <h2 className="font-display text-2xl">{seo.membershipOffer.title}</h2>
            <p className="mt-3 leading-relaxed text-textSecondary">{seo.membershipOffer.body}</p>
          </aside>
        )}
        <nav className="mt-8 flex flex-wrap gap-5">
          <Link href="/signup/pro" className="underline underline-offset-4">
            {brand.home.hero.ctaPro}
          </Link>
          <Link href="/looks" className="underline underline-offset-4">
            {brand.home.hero.ctaBrowse}
          </Link>
        </nav>
      </article>
    </main>
  )
}
