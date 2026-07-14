// app/pro/calendar/_hooks/useDragEdgePagination.ts
'use client'

import { useCallback, useEffect, useRef, type DragEvent } from 'react'

import type { ViewMode } from '../_types'

import {
  edgePageDirectionFromClientX,
  type EdgePageDirection,
} from '../_utils/dragEdge'

// Cross-week drag: while a booking tile is dragged in week view, dwelling the
// pointer in the left/right edge band paginates one week and the native HTML5
// drag keeps going (the browser owns the drag session; drop identity lives in
// `useDragDrop` refs, so a drop on a new-week column still PATCHes correctly).

const EDGE_THRESHOLD_PX = 48
// How long the pointer must dwell in an edge band before the week flips. Long
// enough that skimming past an edge on the way to a column doesn't paginate.
const DWELL_MS = 550

type UseDragEdgePaginationArgs = {
  view: ViewMode
  // -1 = previous week, 1 = next week. Optional so callers can omit it.
  onEdgePage?: (direction: -1 | 1) => void
}

export function useDragEdgePagination({
  view,
  onEdgePage,
}: UseDragEdgePaginationArgs) {
  const enabled = view === 'week' && typeof onEdgePage === 'function'

  const onEdgePageRef = useRef(onEdgePage)
  useEffect(() => {
    onEdgePageRef.current = onEdgePage
  }, [onEdgePage])

  const dwellTimerRef = useRef<number | null>(null)
  const dwellDirectionRef = useRef<EdgePageDirection>(0)
  // One page turn per dwell: after firing, stay latched until the pointer leaves
  // the band (direction returns to 0), so a held finger doesn't run away.
  const latchedRef = useRef(false)

  const clearDwellTimer = useCallback(() => {
    if (dwellTimerRef.current === null) return
    window.clearTimeout(dwellTimerRef.current)
    dwellTimerRef.current = null
  }, [])

  const resetDwell = useCallback(() => {
    clearDwellTimer()
    dwellDirectionRef.current = 0
    latchedRef.current = false
  }, [clearDwellTimer])

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!enabled) return

      const rect = event.currentTarget.getBoundingClientRect()
      const direction = edgePageDirectionFromClientX({
        clientX: event.clientX,
        left: rect.left,
        right: rect.right,
        threshold: EDGE_THRESHOLD_PX,
      })

      // Left the band → drop the timer and re-arm for the next dwell.
      if (direction === 0) {
        resetDwell()
        return
      }

      // Already turned this dwell; wait until the pointer exits the band.
      if (latchedRef.current) return

      // Same band as last frame → let the running timer keep counting.
      if (direction === dwellDirectionRef.current && dwellTimerRef.current !== null) {
        return
      }

      // Entered a band (or switched sides) → (re)start the dwell timer.
      clearDwellTimer()
      dwellDirectionRef.current = direction

      dwellTimerRef.current = window.setTimeout(() => {
        dwellTimerRef.current = null
        latchedRef.current = true
        onEdgePageRef.current?.(direction)
      }, DWELL_MS)
    },
    [clearDwellTimer, enabled, resetDwell],
  )

  // A drop or an abandoned drag ends the session with no further dragover events,
  // so cancel any pending flip here (mirrors the window-listener cleanup the
  // resize gesture uses in useDragDrop).
  useEffect(() => {
    if (!enabled) return

    const handleEnd = () => resetDwell()

    window.addEventListener('dragend', handleEnd)
    window.addEventListener('drop', handleEnd)

    return () => {
      window.removeEventListener('dragend', handleEnd)
      window.removeEventListener('drop', handleEnd)
      resetDwell()
    }
  }, [enabled, resetDwell])

  return { onDragOver }
}
