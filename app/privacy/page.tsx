// app/privacy/page.tsx
import Link from 'next/link'
import { TRANSACTIONAL_SMS_PAGE_COPY } from '@/lib/transactionalSmsPolicy'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandConfig } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export default function PrivacyPage() {
  const brand = getBrandConfig()

  return (
    <main className="min-h-screen w-full text-textPrimary">
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">

        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">Legal</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            Privacy Policy
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
            This page explains what information {brand.displayName} collects and how it
            is used within the product.
          </p>
        </header>

        <div className="grid divide-y divide-textPrimary/8">

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Information we collect
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {brand.displayName} may collect account details such as name, email address,
              phone number, role, signup location details, and
              booking/support information you provide while using the product.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              How we use phone numbers
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {TRANSACTIONAL_SMS_PAGE_COPY}
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              No marketing SMS
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {brand.displayName} sends transactional messages only. We do not send marketing
              or promotional SMS.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Questions
            </h2>
            <p className="mb-5 text-[14px] leading-relaxed text-textSecondary">
              Use the support page for any privacy or account questions.
            </p>
            <Link
              href="/support"
              className="inline-flex items-center justify-center rounded-full border border-textPrimary/20 px-6 py-2.5 text-[13px] font-bold text-textPrimary/80 transition hover:border-textPrimary/35 active:scale-[0.98]"
            >
              Contact Support →
            </Link>
          </section>

        </div>
      </div>
    </main>
  )
}
