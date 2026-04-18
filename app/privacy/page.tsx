// app/privacy/page.tsx
import Link from 'next/link'
import { TRANSACTIONAL_SMS_PAGE_COPY } from '@/lib/transactionalSmsPolicy'

export const dynamic = 'force-dynamic'

export default function PrivacyPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 text-textPrimary">
      <header className="grid gap-3">
        <h1 className="text-3xl font-black">Privacy Policy</h1>
        <p className="text-sm text-textSecondary">
          This page explains the main categories of information TOVIS collects
          and how TOVIS uses that information in the product.
        </p>
      </header>

      <section className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">Information TOVIS collects</h2>
        <p className="text-sm text-textSecondary">
          TOVIS may collect account details such as name, email address, phone
          number, role, signup location details, and booking/support information
          you provide while using the product.
        </p>
      </section>

      <section className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">How TOVIS uses phone numbers</h2>
        <p className="text-sm text-textSecondary">
          {TRANSACTIONAL_SMS_PAGE_COPY}
        </p>
      </section>

      <section className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">No marketing/promotional SMS</h2>
        <p className="text-sm text-textSecondary">
          The intended public policy story for the current product state is
          transactional SMS only, not marketing or promotional SMS.
        </p>
      </section>

      <section className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">Questions</h2>
        <p className="text-sm text-textSecondary">
          Use the public support page for privacy or account questions.
        </p>
        <div>
          <Link
            href="/support"
            className="rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-bgPrimary/30"
          >
            Go to Support
          </Link>
        </div>
      </section>
    </main>
  )
}