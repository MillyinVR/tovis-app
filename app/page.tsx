// app/page.tsx
import Link from 'next/link'
import {
  TRANSACTIONAL_SMS_PAGE_COPY,
  TRANSACTIONAL_SMS_USE_CASES,
} from '@/lib/transactionalSmsPolicy'

export const dynamic = 'force-dynamic'

const publicLinks = [
  { href: '/about', label: 'About' },
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/faq', label: 'FAQ' },
] as const

export default function Home() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-8 text-textPrimary">
      <header className="grid gap-6 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-6 tovis-glass-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black tracking-[0.2em] text-textSecondary">
              TOVIS
            </div>
            <h1 className="mt-2 text-3xl font-black">
              Booking and client management for beauty professionals, with a
              simple client experience for discovery and appointments.
            </h1>
          </div>

          <div className="flex flex-wrap gap-2">
            {publicLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-4 py-2 text-sm font-black text-textPrimary transition hover:border-surfaceGlass/20 hover:bg-bgPrimary/30"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <p className="max-w-3xl text-sm text-textSecondary">
          TOVIS helps beauty professionals run their business from their phone
          and helps clients discover looks, choose services, and book
          appointments. The product supports account creation, booking-related
          flows, support intake, and transactional appointment communication.
        </p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/signup/client"
            className="inline-flex items-center justify-center rounded-full border border-accentPrimary/35 bg-accentPrimary/26 px-5 py-2.5 text-sm font-black text-textPrimary transition hover:bg-accentPrimary/30 hover:border-accentPrimary/45"
          >
            Create Client Account
          </Link>

          <Link
            href="/signup/pro"
            className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-5 py-2.5 text-sm font-black text-textPrimary transition hover:border-surfaceGlass/20 hover:bg-bgPrimary/30"
          >
            Create Pro Account
          </Link>

          <Link
            href="/looks"
            className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-5 py-2.5 text-sm font-black text-textPrimary transition hover:border-surfaceGlass/20 hover:bg-bgPrimary/30"
          >
            Browse Looks
          </Link>
        </div>
      </header>

      <section className="grid gap-4 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-6">
        <h2 className="text-xl font-black">Who TOVIS serves</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-4">
            <div className="text-sm font-black">Clients</div>
            <p className="mt-2 text-sm text-textSecondary">
              Clients use TOVIS to discover beauty professionals, review looks,
              and manage bookings.
            </p>
          </div>

          <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-4">
            <div className="text-sm font-black">Professionals</div>
            <p className="mt-2 text-sm text-textSecondary">
              Professionals use TOVIS to create an account, manage services,
              confirm locations, and handle client appointments.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-6">
        <h2 className="text-xl font-black">Transactional SMS only</h2>
        <p className="text-sm text-textSecondary">
          {TRANSACTIONAL_SMS_PAGE_COPY}
        </p>

        <ul className="grid gap-2 text-sm text-textSecondary">
          {TRANSACTIONAL_SMS_USE_CASES.map((item) => (
            <li key={item} className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-6">
        <h2 className="text-xl font-black">Need help?</h2>
        <p className="text-sm text-textSecondary">
          Use the public support page to contact TOVIS, report an issue, or ask
          for help with your account or booking flow.
        </p>
        <div>
          <Link
            href="/support"
            className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-5 py-2.5 text-sm font-black text-textPrimary transition hover:border-surfaceGlass/20 hover:bg-bgPrimary/30"
          >
            Go to Support
          </Link>
        </div>
      </section>
    </main>
  )
}