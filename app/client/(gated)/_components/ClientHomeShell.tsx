// app/client/(gated)/_components/ClientHomeShell.tsx
import Link from 'next/link'

import type { ClientHomeData } from '../_data/getClientHomeData'

import UpcomingAppointmentCard from './UpcomingAppointmentCard'
import ClientActionCard from './ClientActionCard'
import ClientLastMinuteInvites from './ClientLastMinuteInvites'
import ClientWaitlistStrip from './ClientWaitlistStrip'
import FavoriteProsRow from './FavoriteProsRow'
import FavoritedServicesRow from './FavoritedServicesRow'
import ViralLooksBand from './ViralLooksBand'

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
  const hasAlert = home.action !== null

  return (
    <main
      className="relative -mx-4 w-screen overflow-x-hidden bg-bgPrimary text-textPrimary md:mx-0 md:w-full"
      style={{
        paddingTop: 'max(30px, env(safe-area-inset-top, 0px) + 22px)',
        paddingBottom: 'max(120px, env(safe-area-inset-bottom, 0px) + 100px)',
      }}
    >
      {/* Atmospheric glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[280px]"
        style={{
          background:
            'linear-gradient(180deg, rgb(var(--accent-primary) / 0.12) 0%, rgb(var(--accent-primary) / 0.03) 45%, transparent 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-[300px] w-[300px] rounded-full"
        style={{ background: 'rgb(var(--accent-primary) / 0.12)', filter: 'blur(72px)' }}
      />

      {/* Greeting header */}
      <header className="relative mx-auto flex max-w-[1040px] items-start justify-between gap-4 px-4 pb-6 pt-[30px] md:px-8">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-textMuted">
            {greetingLabel()}
          </p>
          <h1 className="mt-[7px] font-display text-[32px] font-semibold italic leading-none tracking-[-0.03em] text-textPrimary md:text-[40px]">
            {displayName}.
          </h1>
        </div>

        <Link
          href="/client/inbox"
          aria-label="Inbox"
          className="relative grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border border-textPrimary/16 text-textMuted transition hover:border-textPrimary/25 hover:text-textSecondary"
        >
          <svg width="16" height="18" viewBox="0 0 15 17" fill="none">
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
          {hasAlert ? (
            <span className="absolute right-2 top-[7px] h-[7px] w-[7px] rounded-full border-[1.5px] border-bgPrimary bg-gold" />
          ) : null}
        </Link>
      </header>

      {/* Main grid */}
      <div className="relative mx-auto grid max-w-[1040px] items-start gap-5 px-4 md:grid-cols-2 md:gap-[22px] md:px-8">
        <div className="grid min-w-0 content-start gap-5 md:gap-[22px]">
          <ClientActionCard action={home.action} />
          <ClientLastMinuteInvites invites={home.invites} />
          <UpcomingAppointmentCard
            booking={home.upcoming}
            upcomingCount={home.upcomingCount}
          />
        </div>
        <div className="grid min-w-0 content-start gap-5 md:gap-[22px]">
          <FavoriteProsRow
            favoritePros={home.favoritePros}
            removeProFavoriteAction={removeProFavoriteAction}
          />
          <FavoritedServicesRow favoriteServices={home.favoriteServices} />
          <ClientWaitlistStrip waitlists={home.waitlists} />
        </div>
      </div>

      {/* Viral Looks band */}
      <ViralLooksBand
        viralLive={home.viralLive}
        viralPending={home.viralPending}
      />
    </main>
  )
}
