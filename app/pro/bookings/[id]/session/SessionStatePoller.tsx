// app/pro/bookings/[id]/session/SessionStatePoller.tsx
'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

import { useSessionState } from '@/lib/proSession/useSessionState'

type Props = {
  bookingId: string
  initialStateHash?: string | null
  intervalMs?: number
}

/**
 * Invisible companion to the server-rendered Pro session pages. Polls the
 * session state endpoint and refreshes the route when the booking's session
 * state changes on the server (consultation approval, checkout, cancel,
 * aftercare), so the Pro sees updates within seconds without reloading.
 */
export default function SessionStatePoller({
  bookingId,
  initialStateHash = null,
  intervalMs,
}: Props) {
  const router = useRouter()

  const handleChange = useCallback(() => {
    router.refresh()
  }, [router])

  useSessionState({
    bookingId,
    initialStateHash,
    intervalMs,
    onChange: handleChange,
  })

  return null
}
