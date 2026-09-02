'use client'

import { useEffect, useState, type RefObject } from 'react'

export type ElementSize = { width: number; height: number }

/**
 * The rendered pixel size of an element, kept current with a `ResizeObserver`.
 *
 * `null` until the first measurement, so a caller can tell "not measured yet"
 * apart from "measured as zero" — the distinction matters where the geometry is
 * load-bearing: {@link MediaFill}'s crop path must paint NOTHING until it knows
 * both the container and the source, because painting early would show pixels
 * outside the frame the client consented to.
 *
 * Sibling of {@link useElementHeightCssVar}, which publishes a height to a CSS
 * custom property instead of returning it — different consumer, same measuring
 * discipline (never hard-code a size that the layout decides).
 *
 * `ResizeObserver` is absent in jsdom, so unit tests get the one-shot
 * `getBoundingClientRect` measurement and no updates, which is enough for them.
 */
export function useElementSize(
  ref: RefObject<HTMLElement | null>,
): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const update = () => {
      const rect = element.getBoundingClientRect()

      // A zero measurement is not a size, it is the absence of one — an element
      // that has not been laid out yet, or one inside a `display: none` subtree,
      // reports exactly this. Reporting it as measured would tell the crop path
      // "go ahead, the container is 0×0", and it would lay out against nothing.
      if (rect.width <= 0 || rect.height <= 0) {
        setSize((previous) => (previous === null ? previous : null))
        return
      }

      setSize((previous) =>
        previous && previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      )
    }

    update()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => observer.disconnect()
  }, [ref])

  return size
}
