// app/messages/_components/InboxTimeLabel.tsx
'use client'

import { useSyncExternalStore } from 'react'

import {
  DEFAULT_TIME_ZONE,
  formatRelativeTimeCompact,
  getViewerTimeZone,
} from '@/lib/time'

// The store never changes after mount; we only need the client/server snapshot
// split, so the subscribe callback is a no-op.
const noopSubscribe = () => () => {}

/**
 * Inbox thread timestamp resolved in the VIEWER's timezone.
 *
 * The inbox is a server component, so it can only format the instant in the
 * server's zone (UTC on Vercel). The relative buckets ("5m", "3h") are pure
 * elapsed time and don't care, but the older-than-a-year fallback is a
 * calendar date, and a late-evening message would print the NEXT day's date
 * for a US viewer. Same shape as `ClientGreeting`: useSyncExternalStore renders
 * `serverLabel` during SSR + hydration — the exact string the server already
 * put in the markup, so hydration matches even if the clock crossed a bucket
 * boundary in between — then swaps to the viewer-zone label on the client.
 */
export default function InboxTimeLabel({
  at,
  serverLabel,
}: {
  /** UTC ISO instant of the thread's last activity. */
  at: string
  /** The label the server rendered for `at` (in DEFAULT_TIME_ZONE). */
  serverLabel: string
}) {
  return useSyncExternalStore(
    noopSubscribe,
    () =>
      formatRelativeTimeCompact(at, getViewerTimeZone() ?? DEFAULT_TIME_ZONE),
    () => serverLabel,
  )
}
