// app/faq/page.tsx
import Link from 'next/link'
import { TRANSACTIONAL_SMS_PAGE_COPY } from '@/lib/transactionalSmsPolicy'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandConfig } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export default function FaqPage() {
  const brand = getBrandConfig()
  const n = brand.displayName // shorthand for inline use

  const faqs = [
    {
      q: `What is ${n}?`,
      a: `${n} is a platform for beauty professionals and clients. Professionals use it to manage business and appointment flows. Clients use it to discover looks, choose services, and manage bookings.`,
    },
    {
      q: `Why does ${n} ask for my phone number during signup?`,
      a: `${n} uses phone numbers for transactional account and appointment messaging only.`,
    },
    {
      q: `What SMS messages can ${n} send?`,
      a: TRANSACTIONAL_SMS_PAGE_COPY,
    },
    {
      q: `Does ${n} send marketing or promotional SMS?`,
      a: `No. ${n} only sends transactional messages related to account verification and appointment updates.`,
    },
    {
      q: `How do I contact ${n}?`,
      a: 'Use the support page to submit a request — we respond to all inquiries.',
    },
  ]

  return (
    <main className="min-h-screen w-full text-textPrimary">
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">

        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">FAQ</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            Common questions
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
            Plain-English answers about {brand.displayName}, signup, and transactional SMS.
          </p>
        </header>

        <div className="grid divide-y divide-textPrimary/8">
          {faqs.map((item) => (
            <div key={item.q} className="py-7">
              <h2 className="mb-2 text-[15px] font-bold text-textPrimary">
                {item.q}
              </h2>
              <p className="text-[14px] leading-relaxed text-textSecondary">
                {item.a}
              </p>
            </div>
          ))}

          <div className="py-7">
            <Link
              href="/support"
              className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-6 py-2.5 text-[13px] font-bold text-[#F2EDE7] transition hover:bg-accentPrimaryHover active:scale-[0.98]"
            >
              Go to Support
            </Link>
          </div>
        </div>

      </div>
    </main>
  )
}
