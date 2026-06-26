// app/client/(gated)/_components/ClientHomeShell.tsx
import type { ClientHomeData } from '../_data/getClientHomeData'

import ClientGreeting from './ClientGreeting'
import UpcomingAppointmentCard from './UpcomingAppointmentCard'
import ClientActionCard from './ClientActionCard'
import InboxBell from './InboxBell'
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

export default function ClientHomeShell({
  displayName,
  home,
  removeProFavoriteAction,
}: ClientHomeShellProps) {
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
            <ClientGreeting />
          </p>
          <h1 className="mt-[7px] font-display text-[32px] font-semibold italic leading-none tracking-[-0.03em] text-textPrimary md:text-[40px]">
            {displayName}.
          </h1>
        </div>

        <InboxBell />
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
