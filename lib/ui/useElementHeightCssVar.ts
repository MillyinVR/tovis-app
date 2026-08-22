'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Publish an element's rendered height to a CSS custom property on `<html>`.
 *
 * Fixed chrome (the pro header, its banners, the footer bar) is out of flow, so
 * the space it covers has to be reserved by hand. Hard-coding that number is
 * how the reserve silently drifts from the real height — the pro shell reserved
 * `--pro-header-h: 132px` for a header that actually renders 146px tall, which
 * left every sibling positioned against 132px sitting *underneath* the header,
 * painted over and unclickable.
 *
 * Measuring removes the drift by construction: the reserve is whatever the
 * element is, at whatever font size, wrap or content it ends up with.
 *
 * The variable is reset to `0px` on unmount so a route that drops the element
 * does not leave phantom space behind.
 */
export function useElementHeightCssVar(
  ref: RefObject<HTMLElement | null>,
  variableName: `--${string}`,
): void {
  useEffect(() => {
    const element = ref.current

    if (!element) {
      document.documentElement.style.setProperty(variableName, '0px')
      return
    }

    const update = () => {
      const height = element.getBoundingClientRect().height

      document.documentElement.style.setProperty(
        variableName,
        `${Math.max(0, Math.round(height))}px`,
      )
    }

    update()

    // `ResizeObserver` is absent in jsdom-based unit tests; the one-shot
    // measurement above still publishes a correct value there.
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        document.documentElement.style.setProperty(variableName, '0px')
      }
    }

    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => {
      observer.disconnect()
      document.documentElement.style.setProperty(variableName, '0px')
    }
  }, [ref, variableName])
}
