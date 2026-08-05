'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { useLiveChannels } from './useLiveChannels'

type SubscribeToLiveChange = (onChanged: () => void) => () => void

const LiveChangedContext = createContext<SubscribeToLiveChange | null>(null)

/**
 * Live-sync Layer 2 (web): subscribe to this user's Supabase Realtime channels
 * and refetch the route when the server broadcasts a "changed" ping (see
 * lib/live/broadcast.ts). Notify-then-refetch — the ping carries no data, so
 * `router.refresh()` pulls fresh data through the normal server loaders.
 *
 * Channel names are computed server-side (single source of truth) and passed in.
 * The subscribe/debounce/visibility mechanics live in `useLiveChannels`.
 *
 * `router.refresh()` alone only re-runs SERVER components. A surface that holds
 * its data in client state — the pro calendar fetches `/api/v1/pro/calendar`
 * from a hook — keeps rendering the rows it already had, so the pro sat on a
 * stale screen even though the ping arrived. Pass `children` to also expose the
 * ping to descendants through `useLiveChanged`, letting such a surface re-run
 * its own fetch off the SAME subscription (one websocket, many listeners).
 * Without `children` this renders null and behaves exactly as before.
 */
export function LiveRefresh({
  channels,
  children,
}: {
  channels: string[]
  children?: ReactNode
}) {
  const router = useRouter()
  const listenersRef = useRef<Set<() => void>>(new Set())

  useLiveChannels(channels, () => {
    router.refresh()

    // A throwing listener must not silence the ones queued after it.
    listenersRef.current.forEach((listener) => {
      try {
        listener()
      } catch {
        // Best-effort refresh only — never break the others.
      }
    })
  })

  const subscribe = useCallback<SubscribeToLiveChange>((onChanged) => {
    const listeners = listenersRef.current
    listeners.add(onChanged)

    return () => {
      listeners.delete(onChanged)
    }
  }, [])

  if (children === undefined) return null

  return (
    <LiveChangedContext.Provider value={subscribe}>
      {children}
    </LiveChangedContext.Provider>
  )
}

/**
 * Run `onChanged` whenever a live-sync ping reaches the nearest `LiveRefresh`
 * boundary above — for client-fetched surfaces that `router.refresh()` cannot
 * reach on its own.
 *
 * No-ops when there is no boundary above (Realtime unconfigured, or the surface
 * rendered outside the pro shell). The caller's existing load-on-mount, focus
 * and poll paths still keep the data correct — just not instant.
 */
export function useLiveChanged(onChanged: () => void): void {
  const subscribe = useContext(LiveChangedContext)

  // Keep the latest callback in a ref so a fresh identity per render never
  // re-registers. Synced in an effect (not during render) so a ping — always
  // asynchronous — reads the current callback.
  const onChangedRef = useRef(onChanged)
  useEffect(() => {
    onChangedRef.current = onChanged
  })

  useEffect(() => {
    if (!subscribe) return undefined

    return subscribe(() => {
      onChangedRef.current()
    })
  }, [subscribe])
}
