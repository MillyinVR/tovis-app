'use client'

import { useRouter } from 'next/navigation'
import { useLiveChannels } from './useLiveChannels'

/**
 * Live-sync Layer 2 (web): subscribe to this user's Supabase Realtime channels
 * and refetch the route when the server broadcasts a "changed" ping (see
 * lib/live/broadcast.ts). Notify-then-refetch — the ping carries no data, so
 * `router.refresh()` pulls fresh data through the normal server loaders.
 *
 * Channel names are computed server-side (single source of truth) and passed in.
 * The subscribe/debounce/visibility mechanics live in `useLiveChannels`.
 */
export function LiveRefresh({ channels }: { channels: string[] }) {
  const router = useRouter()
  useLiveChannels(channels, () => router.refresh())
  return null
}
