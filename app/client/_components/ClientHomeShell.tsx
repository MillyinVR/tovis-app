// app/client/_components/ClientHomeShell.tsx
import Link from 'next/link'

import type { ClientHomeData } from '../_data/getClientHomeData'

import UpcomingAppointmentCard from './UpcomingAppointmentCard'
import ClientActionCard from './ClientActionCard'
import ClientLastMinuteInvites from './ClientLastMinuteInvites'
import ClientWaitlistStrip from './ClientWaitlistStrip'
import FavoriteProsRow from './FavoriteProsRow'
import RequestLookCard from './RequestLookCard'

type ClientHomeShellProps = {
  brandText: string
  displayName: string
  home: ClientHomeData
  removeProFavoriteAction: (formData: FormData) => Promise<void>
}

function greetingLabel() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function ClientHomeShell({
  displayName,
  home,
  removeProFavoriteAction,
}: ClientHomeShellProps) {
  return (
    <main
      className="relative min-h-dvh overflow-x-hidden bg-bgPrimary text-textPrimary -mx-4 w-screen md:mx-0 md:w-full"
      style={{
        paddingTop: 'max(58px, env(safe-area-inset-top, 0px) + 22px)',
        paddingBottom: 'max(120px, env(safe-area-inset-bottom, 0px) + 100px)',
      }}
    >
      {/* Warm atmospheric glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            'linear-gradient(180deg, rgba(224,90,40,0.12) 0%, rgba(224,90,40,0.05) 45%, transparent 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full md:h-96 md:w-96"
        style={{
          background: 'rgba(224,90,40,0.12)',
          filter: 'blur(72px)',
        }}
      />

      <header className="mb-7 flex items-start justify-between px-5 md:mb-8 md:px-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-textMuted">
            {greetingLabel()}
          </p>
          <h1 className="mt-1.5 font-display text-[32px] font-semibold italic leading-none tracking-[-0.03em] text-textPrimary md:text-[40px]">
            {displayName}.
          </h1>
        </div>

        <Link
          href="/client/inbox"
          aria-label="Inbox"
          className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-textPrimary/16 text-textMuted transition hover:border-textPrimary/25 hover:text-textSecondary"
        >
          <svg width="15" height="17" viewBox="0 0 15 17" fill="none">
            <path
              d="M7.5 1a5 5 0 0 1 5 5c0 2.5.5 4 1.5 5H1c1-1 1.5-2.5 1.5-5a5 5 0 0 1 5-5Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path
              d="M6 11.5a1.5 1.5 0 0 0 3 0"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </Link>
      </header>

      {/* Single column on mobile, 2-column on desktop */}
      <div className="grid gap-5 md:grid-cols-2 md:gap-6 md:items-start">
        <div className="grid min-w-0 gap-5">
          <UpcomingAppointmentCard booking={home.upcoming} />
          <ClientActionCard action={home.action} />
          <ClientLastMinuteInvites invites={home.invites} />
        </div>
        <div className="grid min-w-0 gap-5">
          <ClientWaitlistStrip waitlists={home.waitlists} />
          <FavoriteProsRow
            favoritePros={home.favoritePros}
            removeProFavoriteAction={removeProFavoriteAction}
          />
          <RequestLookCard />
        </div>
      </div>
    </main>
  )
}
