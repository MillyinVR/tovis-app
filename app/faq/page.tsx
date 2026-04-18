// app/faq/page.tsx
import Link from 'next/link'
import { TRANSACTIONAL_SMS_PAGE_COPY } from '@/lib/transactionalSmsPolicy'

export const dynamic = 'force-dynamic'

const faqs = [
  {
    q: 'What is TOVIS?',
    a: 'TOVIS is a product for beauty professionals and clients. Professionals use it to manage business and appointment flows. Clients use it to discover looks, choose services, and manage bookings.',
  },
  {
    q: 'Why does TOVIS ask for my phone number during signup?',
    a: 'TOVIS uses phone numbers for transactional account and appointment messaging.',
  },
  {
    q: 'What SMS messages can TOVIS send?',
    a: TRANSACTIONAL_SMS_PAGE_COPY,
  },
  {
    q: 'Does TOVIS send marketing or promotional SMS?',
    a: 'No. The current transactional-SMS story is account verification and appointment updates only.',
  },
  {
    q: 'How do I contact TOVIS?',
    a: 'Use the public support page to submit a support request.',
  },
] as const

export default function FaqPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 text-textPrimary">
      <header className="grid gap-3">
        <h1 className="text-3xl font-black">FAQ</h1>
        <p className="text-sm text-textSecondary">
          Plain-English answers about TOVIS, signup, and transactional SMS.
        </p>
      </header>

      <div className="grid gap-4">
        {faqs.map((item) => (
          <section
            key={item.q}
            className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5"
          >
            <h2 className="text-base font-black">{item.q}</h2>
            <p className="mt-2 text-sm text-textSecondary">{item.a}</p>
          </section>
        ))}
      </div>

      <div>
        <Link
          href="/support"
          className="rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-bgPrimary/30"
        >
          Go to Support
        </Link>
      </div>
    </main>
  )
}