// lib/live/broadcast.ts
//
// Live-sync Layer 2 (server side): after a write, send a tiny "something
// changed" ping over Supabase Realtime so the other devices (the salon computer
// + the phone) refetch immediately instead of waiting for a poll.
//
// Design: NOTIFY-THEN-REFETCH. The broadcast payload carries NO data — just a
// topic hint. Subscribers refetch through the normal /api/v1 endpoints, so the
// single source of truth and the existing auth/permission checks are preserved
// (a broadcast can never leak a field the API would hide).
//
// Channels are audience-scoped by opaque id:
//   pro:{professionalId}   → the salon (the pro's devices)
//   user:{userId}          → one person's devices (web + iOS both reliably know
//                            their userId from auth, so no clientId lookup needed)
//
// Transport is the Realtime HTTP broadcast endpoint (a plain POST — no
// persistent server connection). It is FAIL-OPEN: if Realtime is unconfigured
// or the POST fails, the write that already succeeded is never affected; the
// clients just fall back to focus-refresh / polling (Layer 1).
import 'server-only'

import { safeError } from '@/lib/security/logging'

/** Coarse hint for what changed, so a subscriber can refetch the right screen. */
export type LiveTopic = 'bookings' | 'consultation' | 'invites'

export function liveChannelForPro(
  professionalId: string | null | undefined,
): string | null {
  return professionalId ? `pro:${professionalId}` : null
}

/** A single person's devices, keyed by userId (what every client knows from auth). */
export function liveChannelForUser(
  userId: string | null | undefined,
): string | null {
  return userId ? `user:${userId}` : null
}

function realtimeConfig(): { url: string; key: string } | null {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  )?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return null
  return { url: url.replace(/\/$/, ''), key }
}

/**
 * Broadcast a "changed" ping to one or more channels. Best-effort: returns
 * `false` (without throwing) when Realtime is unconfigured or the request fails.
 */
export async function broadcastLive(
  channels: Array<string | null | undefined>,
  topic: LiveTopic,
): Promise<boolean> {
  const config = realtimeConfig()
  if (!config) return false

  const messages = channels
    .filter((c): c is string => Boolean(c))
    .map((channel) => ({
      topic: channel,
      event: 'changed',
      payload: { topic },
      private: false,
    }))

  if (messages.length === 0) return false

  try {
    const res = await fetch(`${config.url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({ messages }),
    })
    return res.ok
  } catch (error: unknown) {
    // A failed notify must never break the write that already committed.
    console.warn('broadcastLive failed', { error: safeError(error) })
    return false
  }
}
