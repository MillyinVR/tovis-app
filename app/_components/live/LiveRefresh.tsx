'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

/**
 * Live-sync Layer 2 (web): subscribe to this user's Supabase Realtime channels
 * and refetch the route when the server broadcasts a "changed" ping (see
 * lib/live/broadcast.ts). Notify-then-refetch — the ping carries no data, so
 * `router.refresh()` pulls fresh data through the normal server loaders.
 *
 * Channel names are computed server-side (single source of truth) and passed in.
 * No-ops if Supabase public env is absent. Refreshes are debounced and skipped
 * while the tab is hidden (Layer 1 catches it on focus).
 */
export function LiveRefresh({ channels }: { channels: string[] }) {
  const router = useRouter()
  // Stable primitive dep so the effect re-subscribes only when the set changes.
  const channelsKey = channels.join(',')

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const names = channelsKey.split(',').filter(Boolean)
    if (!url || !key || names.length === 0) return

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    let timer: ReturnType<typeof setTimeout> | undefined
    const refreshSoon = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') router.refresh()
      }, 250)
    }

    const subscriptions = names.map((name) =>
      supabase
        .channel(name)
        .on('broadcast', { event: 'changed' }, refreshSoon)
        .subscribe(),
    )

    return () => {
      if (timer) clearTimeout(timer)
      subscriptions.forEach((channel) => {
        void supabase.removeChannel(channel)
      })
    }
  }, [router, channelsKey])

  return null
}
