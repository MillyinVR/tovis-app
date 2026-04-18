// app/terms/page.tsx
import Link from 'next/link'
import { TRANSACTIONAL_SMS_PAGE_COPY } from '@/lib/transactionalSmsPolicy'

export const dynamic = 'force-dynamic'

export default function TermsPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 text-textPrimary">
      <header className="grid gap-3">
        <h1 className="text-3xl font-black">Terms & Conditions</h1>
        <p className="text-sm text-textSecondary">
          These terms describe the basic rules for using TOVIS.
        </p>
      </header>

      <section className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">Accounts</h2>
        <p className="text-sm text-textSecondary">
          Users must provide accurate signup information and keep account access
          secure.
        </p>
      </section>

      <section className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">Transactional SMS consent</h2>
        <p className="text-sm text-textSecondary">
          TOVIS collects separate consent during web/app signup for
          transactional SMS messages related to account verification and
          appointment updates.
        </p>
        <p className="text-sm text-textSecondary">{TRANSACTIONAL_SMS_PAGE_COPY}</p>
      </section>

      <section className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">No marketing/promotional SMS</h2>
        <p className="text-sm text-textSecondary">
          The current product policy story is transactional SMS only. Marketing
          or promotional SMS is not part of this TFV flow.
        </p>
      </section>

      <section className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">Support</h2>
        <p className="text-sm text-textSecondary">
          For account or policy questions, use the public support page.
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