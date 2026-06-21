'use client'

import { useEffect, useState } from 'react'

import {
  loadViewerLocation,
  subscribeViewerLocation,
  type ViewerLocation,
} from '@/lib/viewerLocation'

/**
 * Subscribe a client component to the viewer's saved location. The initial
 * value is read lazily (SSR-safe: `null` on the server) and the effect only
 * wires the subscription, so there's no synchronous setState in the effect
 * body. Shared by the Looks feed + look detail views.
 */
export function useViewerLocation(): ViewerLocation | null {
  const [viewerLoc, setViewerLoc] = useState<ViewerLocation | null>(() =>
    typeof window === 'undefined' ? null : loadViewerLocation(),
  )

  useEffect(() => subscribeViewerLocation(setViewerLoc), [])

  return viewerLoc
}
