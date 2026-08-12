'use client'

// app/client/(gated)/_components/ClientMarkAllReadButton.tsx
//
// The ONE "Mark all read" control on the client surface.
//
// ## Why this is shared
// /client/notifications and /client/activity both mark notifications read, and
// both used to hand-roll it: two `fetch('/api/v1/client/notifications/read')`
// calls with different bodies, different error handling, and — because nothing
// tied them together — two different LOOKS for the same control (a filled pill
// on one page, bare text on the other). The endpoint is the same one; only the
// selector differs, so the selector is the prop and everything else lives here.
//
// The two pages also reflect the result differently, and both ways are right:
// notifications is server-rendered so it refreshes, while activity holds its
// own rows in state and clears them optimistically. That is what onOptimistic /
// onRollback / onSuccess are for — they are the only real difference left.
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { cn } from '@/lib/utils'

export type ClientMarkAllReadButtonProps = {
  /**
   * Drives the disabled state, so an optimistic caller should pass its LIVE
   * count — clearing it to 0 disables the button and is what stops a second
   * submit while the request is in flight.
   */
  unreadCount: number
  /**
   * Which notification kinds to mark. Omit to mark EVERY notification read —
   * the route treats a missing selector as "all", which is what
   * /client/notifications wants.
   */
  eventKeys?: readonly string[]
  /** Runs before the request, so a caller holding its own rows can clear them. */
  onOptimistic?: () => void
  /** Runs when the request fails, so an optimistic caller can put them back. */
  onRollback?: () => void
  /** Runs on success. Defaults to router.refresh() for a server-rendered list. */
  onSuccess?: () => void
}

export default function ClientMarkAllReadButton({
  unreadCount,
  eventKeys,
  onOptimistic,
  onRollback,
  onSuccess,
}: ClientMarkAllReadButtonProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const disabled = unreadCount <= 0 || isSubmitting

  async function handleClick() {
    if (disabled) return
    setIsSubmitting(true)
    onOptimistic?.()

    try {
      const res = await fetch('/api/v1/client/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No selector → the route marks all of this client's notifications.
        body: JSON.stringify(eventKeys ? { eventKeys } : {}),
        cache: 'no-store',
      })
      if (!res.ok) {
        onRollback?.()
        setIsSubmitting(false)
        return
      }
      if (onSuccess) onSuccess()
      else router.refresh()
    } catch {
      onRollback?.()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        'brand-focus inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition',
        disabled
          ? 'cursor-not-allowed border-surfaceGlass/10 bg-bgPrimary/20 text-textSecondary/70'
          : 'border-accentPrimary/35 bg-accentPrimary/12 text-textPrimary hover:border-accentPrimary/55',
      )}
      aria-disabled={disabled}
      aria-label={
        unreadCount > 0
          ? `Mark all ${unreadCount} unread notifications as read`
          : 'No unread notifications'
      }
    >
      {isSubmitting ? 'Marking…' : 'Mark all read'}
    </button>
  )
}
