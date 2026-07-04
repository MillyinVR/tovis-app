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
  /**
   * Let vertical gestures fall through to a scrolling ancestor (the Looks feed's
   * vertical snap pager) while the slider still owns *horizontal* drags. When
   * false (the default, for small tiles in a normally-scrolling page) the slider
   * owns every gesture the moment a pointer lands — `touch-action: none`, and a
   * tap moves the divider. When true, `touch-action: pan-y` keeps native
   * vertical scrolling, a plain tap does nothing (so double-tap-to-like still
   * reaches the slide), and only a decisively horizontal drag engages the wipe.
   */
  passVerticalScroll?: boolean
}

/** Keyboard nudge, in fraction units (matches the arrow-key feel of a slider). */
const STEP = 0.04

/**
 * Horizontal travel (px) a pointer must exceed — and beat its vertical travel —
 * before the slider claims the gesture in `passVerticalScroll` mode. Below this
 * the browser is still free to start a vertical scroll.
 */
const ENGAGE_THRESHOLD_PX = 8

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
  passVerticalScroll = false,
}: Props) {
  /** How much of the "before" is revealed from the left, 0…1. */
  const [fraction, setFraction] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  // In passVerticalScroll mode we don't claim the gesture until a horizontal
  // drag proves itself; this holds the pointer's origin while we watch it.
  const pendingStartRef = useRef<{ x: number; y: number } | null>(null)

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
      if (passVerticalScroll) {
        // Watch, don't claim: let the browser keep the option of a vertical
        // scroll until the pointer moves decisively sideways. No capture, no
        // preventDefault, no stopPropagation yet.
        pendingStartRef.current = { x: e.clientX, y: e.clientY }
        draggingRef.current = false
        return
      }
      // Own the gesture: never let a tap/drag reach a parent link/button.
      e.preventDefault()
      e.stopPropagation()
      draggingRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setFromClientX(e.clientX)
    },
    [passVerticalScroll, setFromClientX],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        const start = pendingStartRef.current
        if (!start) return
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        // Vertical intent wins → release it to the pager and stop watching.
        if (Math.abs(dy) > ENGAGE_THRESHOLD_PX && Math.abs(dy) >= Math.abs(dx)) {
          pendingStartRef.current = null
          return
        }
        // Decisively horizontal → claim the gesture for the wipe.
        if (Math.abs(dx) > ENGAGE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
          draggingRef.current = true
          pendingStartRef.current = null
          e.currentTarget.setPointerCapture(e.pointerId)
        }
        return
      }
      if (passVerticalScroll) {
        // Now that we own it, keep the browser from also scrolling.
        e.preventDefault()
        e.stopPropagation()
      }
      setFromClientX(e.clientX)
    },
    [passVerticalScroll, setFromClientX],
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    pendingStartRef.current = null
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
      // pan-y hands vertical panning back to the feed pager; the pointer handlers
      // still claim horizontal drags for the wipe (see passVerticalScroll).
      style={passVerticalScroll ? { touchAction: 'pan-y' } : undefined}
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
        // In passthrough mode a plain tap is left alone so double-tap-to-like on
        // the feed slide still fires; a drag never produces a click here anyway.
        if (passVerticalScroll) return
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
