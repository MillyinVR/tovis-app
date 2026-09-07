// app/about/page.tsx
import Link from 'next/link'
import { buildTransactionalSmsSummary } from '@/lib/transactionalSmsPolicy'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { defaultAboutCopy } from '@/lib/brand/defaultAboutCopy'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const dynamic = 'force-dynamic'

export default async function AboutPage() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = defaultAboutCopy(brand.displayName)

  return (
    <main className="min-h-screen w-full text-textPrimary">
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">

        {/* Page heading */}
        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">About</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            {copy.title}
          </h1>
          {copy.intro.map((paragraph, i) => (
            <p
              key={paragraph}
              className={
                i === 0
                  ? 'mt-5 text-[17px] leading-relaxed text-textPrimary'
                  : 'mt-4 text-[15px] leading-relaxed text-textSecondary'
              }
            >
              {paragraph}
            </p>
          ))}
        </header>

        <div className="grid divide-y divide-textPrimary/8">

          {copy.sections.map((section) => (
            <section key={section.title} className="py-8">
              <div className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
                {section.label}
              </div>
              <h2 className="font-display mb-3 text-[22px] font-semibold leading-snug tracking-tight">
                {section.title}
              </h2>
              <p className="text-[14px] leading-relaxed text-textSecondary">
                {section.body}
              </p>
            </section>
          ))}

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              {copy.does.title}
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {copy.does.body}
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              {copy.smsTitle}
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {buildTransactionalSmsSummary(brand.displayName)}
            </p>
          </section>

          <div className="py-8">
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup/client"
                className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-6 py-2.5 text-[13px] font-bold text-textPrimary transition hover:bg-accentPrimaryHover active:scale-[0.98]"
              >
                Create client account
              </Link>
              <Link
                href="/signup/pro"
                className="inline-flex items-center justify-center rounded-full border border-textPrimary/20 px-6 py-2.5 text-[13px] font-bold text-textPrimary/80 transition hover:border-textPrimary/35 active:scale-[0.98]"
              >
                Pro signup
              </Link>
              <Link
                href="/support"
                className="inline-flex items-center justify-center rounded-full border border-textPrimary/20 px-6 py-2.5 text-[13px] font-bold text-textPrimary/80 transition hover:border-textPrimary/35 active:scale-[0.98]"
              >
                Support
              </Link>
            </div>
          </div>

        </div>
      </div>
    </main>
  )
}
