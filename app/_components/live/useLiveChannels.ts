'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

/**
 * Live-sync Layer 2 (web) primitive: subscribe to one or more Supabase Realtime
 * channels and invoke `onChanged` whenever the server broadcasts a "changed"
 * ping (see lib/live/broadcast.ts). The ping carries no data — callers refetch
 * through the normal loaders/endpoints, so the API stays the single source of
 * truth (a broadcast can never leak a field the API would hide).
 *
 * The callback is debounced (250ms) and skipped while the tab is hidden — the
 * caller's focus handler catches up on return. No-ops if Supabase public env is
 * absent or no channels are given.
 *
 * Shared by `LiveRefresh` (whole-route `router.refresh()`) and the thread view
 * (targeted message refetch) so the subscribe/debounce/visibility logic lives in
 * one place.
 */
export function useLiveChannels(channels: string[], onChanged: () => void): void {
  // Stable primitive dep so the effect re-subscribes only when the set changes.
  const channelsKey = channels.join(',')

  // Keep the latest callback in a ref so a new callback identity per render
  // never tears down and rebuilds the subscription. Synced in an effect (not
  // during render) so a broadcast — which always fires asynchronously — reads
  // the current callback.
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  })

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    // Match the rest of the client (uploadWithProgress): prefer the new
    // publishable key, fall back to the legacy anon key.
    const key =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const names = channelsKey.split(',').filter(Boolean)
    if (!url || !key || names.length === 0) return

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    let timer: ReturnType<typeof setTimeout> | undefined
    const changedSoon = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') onChangedRef.current()
      }, 250)
    }

    const subscriptions = names.map((name) =>
      supabase
        .channel(name)
        .on('broadcast', { event: 'changed' }, changedSoon)
        .subscribe(),
    )

    return () => {
      if (timer) clearTimeout(timer)
      subscriptions.forEach((channel) => {
        void supabase.removeChannel(channel)
      })
    }
  }, [channelsKey])
}
