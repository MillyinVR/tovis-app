// app/about/page.tsx
import Link from 'next/link'
import { TRANSACTIONAL_SMS_SUMMARY } from '@/lib/transactionalSmsPolicy'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandConfig } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export default function AboutPage() {
  const brand = getBrandConfig()

  return (
    <main className="min-h-screen w-full text-textPrimary">
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">

        {/* Page heading */}
        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">About</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            What is {brand.displayName}?
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
            {brand.displayName} is a beauty-services platform for professionals and clients.
            Professionals use it to manage business and appointment flows.
            Clients use it to discover looks, choose services, and manage bookings.
          </p>
        </header>

        <div className="grid divide-y divide-textPrimary/8">

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              What {brand.displayName} does
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {brand.displayName} supports account creation, service discovery, location-aware
              signup, professional onboarding, booking-related workflows, and
              public support intake.
            </p>
          </section>

          <section className="py-8">
            <h2 className="mb-3 text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase">
              How {brand.displayName} uses SMS
            </h2>
            <p className="text-[14px] leading-relaxed text-textSecondary">
              {TRANSACTIONAL_SMS_SUMMARY}
            </p>
          </section>

          <div className="py-8">
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup/client"
                className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-6 py-2.5 text-[13px] font-bold text-[#F2EDE7] transition hover:bg-accentPrimaryHover active:scale-[0.98]"
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
