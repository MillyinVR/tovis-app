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
      className="relative -mt-4 overflow-x-hidden bg-bgPrimary text-textPrimary"
      style={{
        // Full-bleed at every breakpoint, independent of the gated layout's
        // constrained wrapper (max-w-5xl px-4 pt-4): break out to the viewport
        // edges so the atmospheric glow spans seamlessly, while the inner
        // header/grid/band keep their own max-w-[1040px] centering. This
        // removes the parent's 1024px cap and the double horizontal padding.
        // -mt-4 cancels the wrapper's pt-4 so the glow sits flush at the top.
        width: '100vw',
        marginLeft: 'calc(50% - 50vw)',
        marginRight: 'calc(50% - 50vw)',
        paddingTop: 'max(30px, env(safe-area-inset-top, 0px) + 22px)',
        paddingBottom: 'max(120px, env(safe-area-inset-bottom, 0px) + 100px)',
      }}
    >
      {/* Atmospheric glow — both layers are horizontally symmetric and span
          the full width (inset-x-0), so the top glow reads seamlessly edge to
          edge with no hard cut-off. Vertical fade band + a centered radial pop
          (replaces the old top-right blob that skewed bright to one side). */}
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
        className="pointer-events-none absolute inset-x-0 top-0 h-[320px]"
        style={{
          background:
            'radial-gradient(120% 90% at 50% -20%, rgb(var(--accent-primary) / 0.16), rgb(var(--accent-primary) / 0.05) 45%, transparent 72%)',
        }}
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

      {/* Main grid. grid-cols-1 (= minmax(0,1fr)) so single-column mobile/tablet
          tracks can shrink and inner truncation works; two columns from md up. */}
      <div className="relative mx-auto grid max-w-[1040px] grid-cols-1 items-start gap-5 px-4 md:grid-cols-2 md:gap-[22px] md:px-8">
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 md:gap-[22px]">
          <ClientActionCard action={home.action} />
          <ClientLastMinuteInvites invites={home.invites} />
          <UpcomingAppointmentCard
            booking={home.upcoming}
            upcomingCount={home.upcomingCount}
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-5 md:gap-[22px]">
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
