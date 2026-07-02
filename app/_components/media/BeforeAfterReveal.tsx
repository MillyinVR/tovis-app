'use client'

import React, { useCallback, useRef, useState } from 'react'
import MediaFill from '@/app/_components/media/MediaFill'
import { cn } from '@/lib/utils'

type Props = {
  /** The "before" photo — revealed from the left up to the divider. */
  beforeSrc: string
  /** The "after" photo — fills the frame beneath the before. */
  afterSrc: string
  beforeAlt: string
  afterAlt: string
  className?: string
}

/** Keyboard nudge, in fraction units (matches the arrow-key feel of a slider). */
const STEP = 0.04

/**
 * Interactive before/after comparison slider — the web counterpart of the iOS
 * `BeforeAfterCompareView`. The "after" photo fills the frame; the "before" is
 * layered on top and clipped to a draggable divider, so dragging (or tapping,
 * or arrow keys) wipes between the two. Both layers stay pixel-aligned because
 * the before is *clipped* (`clip-path`), never resized.
 *
 * Images render through {@link MediaFill} to satisfy the raw-`<img>` rule. The
 * slider swallows its own pointer/click events so it can live inside a linked
 * card (e.g. the pro aftercare inbox) without a drag triggering navigation.
 *
 * Rendered by {@link AftercareBeforeAfter} whenever a complete before+after
 * pair exists; when only one half is present the caller falls back to tiles.
 */
export default function BeforeAfterReveal({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  className,
}: Props) {
  /** How much of the "before" is revealed from the left, 0…1. */
  const [fraction, setFraction] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const setFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const next = (clientX - rect.left) / rect.width
    setFraction(Math.min(1, Math.max(0, next)))
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Own the gesture: never let a tap/drag reach a parent link/button.
      e.preventDefault()
      e.stopPropagation()
      draggingRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setFromClientX(e.clientX)
    },
    [setFromClientX],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      setFromClientX(e.clientX)
    },
    [setFromClientX],
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault()
        setFraction((f) => Math.max(0, f - STEP))
        break
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault()
        setFraction((f) => Math.min(1, f + STEP))
        break
      case 'Home':
        e.preventDefault()
        setFraction(0)
        break
      case 'End':
        e.preventDefault()
        setFraction(1)
        break
      default:
        break
    }
  }, [])

  const pct = Math.round(fraction * 1000) / 10
  const valueNow = Math.round(pct)

  return (
    <div
      ref={containerRef}
      className={cn('brand-before-after-reveal', className)}
      role="slider"
      tabIndex={0}
      aria-label="Before and after comparison — drag to reveal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valueNow}
      aria-valuetext={`${valueNow}% before revealed`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="brand-before-after-layer">
        <MediaFill
          src={afterSrc}
          mediaType="IMAGE"
          alt={afterAlt}
          fit="cover"
          className="absolute inset-0 h-full w-full"
          imgProps={{ draggable: false }}
        />
      </div>

      {/* The before, same full-size image, clipped to the left of the divider
          so the two stay pixel-aligned as the divider moves. */}
      <div
        className="brand-before-after-layer"
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
      >
        <MediaFill
          src={beforeSrc}
          mediaType="IMAGE"
          alt={beforeAlt}
          fit="cover"
          className="absolute inset-0 h-full w-full"
          imgProps={{ draggable: false }}
        />
      </div>

      <span
        className="brand-before-after-tag"
        data-side="before"
        style={{ opacity: fraction > 0.12 ? 1 : 0 }}
      >
        BEFORE
      </span>
      <span
        className="brand-before-after-tag"
        data-side="after"
        data-tone="after"
        style={{ opacity: fraction < 0.88 ? 1 : 0 }}
      >
        AFTER
      </span>

      <div className="brand-before-after-divider" style={{ left: `${pct}%` }}>
        <span className="brand-before-after-handle" aria-hidden="true">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
          </svg>
        </span>
      </div>
    </div>
  )
}
