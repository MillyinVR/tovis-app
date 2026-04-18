// app/about/page.tsx
import Link from 'next/link'
import { TRANSACTIONAL_SMS_SUMMARY } from '@/lib/transactionalSmsPolicy'

export const dynamic = 'force-dynamic'

export default function AboutPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 text-textPrimary">
      <header className="grid gap-3">
        <h1 className="text-3xl font-black">About TOVIS</h1>
        <p className="text-sm text-textSecondary">
          TOVIS is a beauty-services product for professionals and clients.
          Professionals use it to manage business and appointment flows.
          Clients use it to discover looks, choose services, and manage
          bookings.
        </p>
      </header>

      <section className="grid gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">What TOVIS does</h2>
        <p className="text-sm text-textSecondary">
          TOVIS supports account creation, service discovery, location-aware
          signup, professional onboarding, booking-related workflows, and public
          support intake.
        </p>
      </section>

      <section className="grid gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-5">
        <h2 className="text-lg font-black">How TOVIS uses SMS</h2>
        <p className="text-sm text-textSecondary">{TRANSACTIONAL_SMS_SUMMARY}</p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/signup/client"
          className="rounded-full border border-accentPrimary/35 bg-accentPrimary/26 px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-accentPrimary/30"
        >
          Client signup
        </Link>
        <Link
          href="/signup/pro"
          className="rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-bgPrimary/30"
        >
          Pro signup
        </Link>
        <Link
          href="/support"
          className="rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-bgPrimary/30"
        >
          Support
        </Link>
      </div>
    </main>
  )
}