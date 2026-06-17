'use client'

import { usePresenceSignals } from '@/lib/presence/usePresenceSignals'

type Props = {
  resourceType: 'opening' | 'offering'
  resourceId: string
  professionalId: string
  serviceId?: string
}

export default function PresenceSignals(props: Props) {
  const { watching, waitlisted } = usePresenceSignals(props)

  // Honest signals: only show "watching" when there's more than just the
  // current viewer, and only show the waitlist count when it's real.
  const showWatching = typeof watching === 'number' && watching >= 2
  const showWaitlist = waitlisted >= 1

  if (!showWatching && !showWaitlist) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {showWatching ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-textPrimary/5 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-textMuted">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accentPrimary/70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accentPrimary" />
          </span>
          {watching} watching now
        </span>
      ) : null}

      {showWaitlist ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-textPrimary/5 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-textMuted">
          {waitlisted} on the waitlist
        </span>
      ) : null}
    </div>
  )
}
