// app/_components/boards/useBoardVisibility.ts
'use client'

import { useCallback, useState } from 'react'
import type { BoardVisibility } from '@prisma/client'

import { COPY } from '@/lib/copy'

/**
 * Flip one board between PRIVATE and SHARED.
 *
 * Shared by the board detail page's share panel and the compact switch on the
 * client's own boards list, so there is one description of what the mutation is
 * and one place for its failure handling. Both surfaces PATCH the same route.
 */
export function useBoardVisibility(args: {
  boardId: string
  initial: BoardVisibility
  onChanged?: (next: BoardVisibility) => void
}) {
  const { boardId, initial, onChanged } = args

  const [visibility, setVisibility] = useState<BoardVisibility>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setVisibilityTo = useCallback(
    async (next: BoardVisibility) => {
      if (busy || next === visibility) return
      setBusy(true)
      setError(null)

      // Optimistic, then reconciled: this is a switch, and waiting a round trip
      // before it moves reads as a dead control. Reverted on failure so the UI
      // never claims a visibility the server did not accept.
      const previous = visibility
      setVisibility(next)

      try {
        const res = await fetch(`/api/v1/boards/${encodeURIComponent(boardId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility: next }),
        })

        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          throw new Error(data?.error || COPY.boards.visibilityError)
        }

        onChanged?.(next)
      } catch (e) {
        setVisibility(previous)
        setError(e instanceof Error ? e.message : COPY.boards.visibilityError)
      } finally {
        setBusy(false)
      }
    },
    [boardId, busy, visibility, onChanged],
  )

  return {
    visibility,
    isShared: visibility === 'SHARED',
    busy,
    error,
    setVisibilityTo,
    toggle: () => setVisibilityTo(visibility === 'SHARED' ? 'PRIVATE' : 'SHARED'),
  }
}
