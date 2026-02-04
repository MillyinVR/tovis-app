// app/client/ClientBookingsHeroCards.tsx
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function pill(n: number | null) {
  if (n == null) return '—'
  if (n <= 0) return '0'
  if (n > 99) return '99+'
  return String(n)
}

function HeroCard(props: {
  href: string
  title: string
  subtitle: string
  count: number | null
  tone?: 'accent' | 'neutral'
}) {
  const tone = props.tone ?? 'neutral'

  return (
    <Link
      href={props.href}
      className={cx(
        'group relative overflow-hidden rounded-card border border-white/10 p-4 transition',
        'bg-bgSecondary hover:bg-surfaceGlass',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-black text-textPrimary">{props.title}</div>
          <div className="mt-1 text-xs font-semibold text-textSecondary">{props.subtitle}</div>

          <div className="mt-3 inline-flex items-center gap-2 text-xs font-black">
            <span
              className={cx(
                'inline-flex items-center rounded-full border px-1 py-1',
                'border-white/10 bg-bgPrimary text-textPrimary',
                tone === 'accent' && 'bg-accentPrimary text-bgPrimary border-white/0',
              )}
            >
              {pill(props.count)}
            </span>
            <span className="text-textSecondary group-hover:text-textPrimary transition">View →</span>
          </div>
        </div>

        <div className="shrink-0 rounded-full border border-white/10 bg-bgPrimary px-1 py-0.5 text-[11px] font-black text-textPrimary">
          Details
        </div>
      </div>
    </Link>
  )
}

export default async function ClientBookingsHeroCards() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client/bookings')
  }

  const clientId = user.clientProfile.id
  const now = new Date()

  const [upcomingCount, pendingCount, unreadAftercareCount] = await Promise.all([
    prisma.booking.count({
      where: {
        clientId,
        status: 'ACCEPTED' as any,
        scheduledFor: { gte: now },
        finishedAt: null,
      } as any,
    }),
    prisma.booking.count({
      where: {
        clientId,
        status: 'PENDING' as any,
      } as any,
    }),
    prisma.clientNotification.count({
      where: {
        clientId,
        type: 'AFTERCARE' as any,
        readAt: null,
      } as any,
    }),
  ])

  // Waitlist: we’ll wire the real count once we confirm your model name.
  const waitlistCount: number | null = null

  return (
    <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="text-sm font-black">Your bookings</div>
        <div className="text-xs font-semibold text-textSecondary">Luxury dashboard. Zero dashboard energy.</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <HeroCard
          href="/client/bookings?view=upcoming"
          title="Upcoming"
          subtitle="Your next appointment(s)."
          count={upcomingCount}
          tone="accent"
        />
        <HeroCard
          href="/client/aftercare"
          title="Aftercare"
          subtitle="Notes, photos, products, rebook."
          count={unreadAftercareCount}
        />
        <HeroCard
          href="/client/bookings?view=pending"
          title="Pending"
          subtitle="Requests awaiting confirmation."
          count={pendingCount}
        />
        <HeroCard
          href="/client/waitlist"
          title="Waitlist"
          subtitle="Spots you’re watching."
          count={waitlistCount}
        />
      </div>
    </section>
  )
}
