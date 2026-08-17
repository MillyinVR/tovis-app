'use client'

import { useCallback, useState } from 'react'
import { LookPostVisibility } from '@prisma/client'

import { COPY } from '@/lib/copy'

/**
 * Flip one client-authored look between public and not.
 *
 * The twin of `useBoardVisibility`, and deliberately the same shape: optimistic
 * flip, reverted on refusal, one description of the mutation and one place for
 * its failure handling.
 *
 * ⚠️ The "off" state is `UNLISTED`, not a `PRIVATE` member — `LookPostVisibility`
 * has no such value (`PUBLIC | FOLLOWERS_ONLY | UNLISTED`). The server owns that
 * mapping (`updateClientLookVisibility` takes a boolean), so this hook talks in
 * booleans too and never names a visibility the enum does not have. The switch
 * still SAYS "Private" to the client, which is what an unlisted look is from
 * their side and what the design file calls it.
 */
export function useLookVisibility(args: {
  lookId: string
  initial: LookPostVisibility | string
  onChanged?: (nextIsPublic: boolean) => void
}) {
  const { lookId, initial, onChanged } = args

  const [isPublic, setIsPublic] = useState(
    () => String(initial).toUpperCase() === LookPostVisibility.PUBLIC,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setPublic = useCallback(
    async (next: boolean) => {
      if (busy || next === isPublic) return
      setBusy(true)
      setError(null)

      const previous = isPublic
      setIsPublic(next)

      try {
        const res = await fetch(
          `/api/v1/client/looks/${encodeURIComponent(lookId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isPublic: next }),
          },
        )

        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          throw new Error(data?.error || COPY.clientLooks.visibilityError)
        }

        onChanged?.(next)
      } catch (e) {
        setIsPublic(previous)
        setError(e instanceof Error ? e.message : COPY.clientLooks.visibilityError)
      } finally {
        setBusy(false)
      }
    },
    [busy, isPublic, lookId, onChanged],
  )

  return {
    isPublic,
    busy,
    error,
    setPublic,
    toggle: () => setPublic(!isPublic),
  }
}
