// app/terms/page.tsx
import Link from 'next/link'
import { TRANSACTIONAL_SMS_PAGE_COPY } from '@/lib/transactionalSmsPolicy'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandConfig } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export default function TermsPage() {
  const brand = getBrandConfig()

  return (
    <main className="min-h-screen w-full text-textPrimary">
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">

        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">Legal</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            Terms &amp; Conditions
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
            These terms describe the basic rules for using {brand.displayName}.
          </p>
        </header>

        <div className="grid divide-y divide-textPrimary/8">

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Accounts
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              Users must provide accurate signup information and keep account
              access secure. You are responsible for all activity under your
              account.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Transactional SMS consent
            </h2>
            <p className="mb-3 text-[14px] leading-relaxed text-textSecondary">
              {brand.displayName} collects separate consent during signup for transactional
              SMS messages related to account verification and appointment
              updates.
            </p>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {TRANSACTIONAL_SMS_PAGE_COPY}
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              No marketing SMS
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {brand.displayName} sends transactional messages only. Marketing or promotional
              SMS is not part of this product.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              Support
            </h2>
            <p className="mb-5 text-[14px] leading-relaxed text-textSecondary">
              For account or policy questions, use the public support page.
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
