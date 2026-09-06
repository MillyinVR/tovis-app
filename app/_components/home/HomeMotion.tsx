// app/_components/home/HomeMotion.tsx
//
// The homepage's motion layer. Renders nothing — it attaches behaviour to the
// markup the server already sent, so the page is complete and readable before
// this ever runs.
//
// Two jobs:
//
//   1. SCROLL REVEAL. Elements marked `.tv-reveal` / `.tv-word` fade up as they
//      enter the viewport. The hidden state lives behind
//      `[data-tv-motion="on"]` (app/styles/home.css), and this component is
//      what sets that attribute — so if the bundle fails to load, or
//      IntersectionObserver is missing, the page renders fully visible rather
//      than blank. That ordering is the whole safety story: never hide
//      anything the code that un-hides it has not already proven it can run.
//
//   2. CURSOR GLOW. A soft accent orb tracking a fine pointer across the hero.
//
// Both are suppressed under prefers-reduced-motion. app/globals.css already
// kills the transitions, but that alone would leave the reveal targets stuck at
// opacity 0 — with no transition there is nothing to carry them back. So the
// query is re-read here and the reveal is skipped outright, which leaves the
// attribute unset and the content visible.
'use client'

import { useEffect } from 'react'

const REVEAL_SELECTOR = '.tv-reveal, .tv-word'

/** Matches the hero's word-by-word entrance cadence, in ms. */
const WORD_STAGGER_MS = 85
const WORD_INITIAL_DELAY_MS = 120

type Props = {
  /**
   * Id of the element the cursor glow is positioned within — the hero section.
   * The glow orb itself must be a `.tv-cursor-glow` child of it.
   */
  scopeId: string
}

export default function HomeMotion({ scopeId }: Props) {
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    const cleanups: Array<() => void> = []

    // ── Scroll reveal ────────────────────────────────────────────────
    // Guarded on both the media query and observer support; either one
    // missing means we leave `data-tv-motion` unset and every target keeps
    // its natural, visible state.
    if (!prefersReducedMotion && typeof IntersectionObserver !== 'undefined') {
      const root = document.documentElement
      root.setAttribute('data-tv-motion', 'on')
      cleanups.push(() => root.removeAttribute('data-tv-motion'))

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            entry.target.classList.add('tv-in')
            observer.unobserve(entry.target)
          }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.15 },
      )
      cleanups.push(() => observer.disconnect())

      // The hero headline is above the fold, so waiting for an intersection
      // would either fire everything on the same frame or (for the words) miss
      // the staggered cadence entirely. Drive those on a timer instead and let
      // the observer take everything below.
      const words = Array.from(document.querySelectorAll<HTMLElement>('.tv-word'))
      const timers = words.map((word, index) =>
        window.setTimeout(
          () => word.classList.add('tv-in'),
          WORD_INITIAL_DELAY_MS + index * WORD_STAGGER_MS,
        ),
      )
      cleanups.push(() => timers.forEach((timer) => window.clearTimeout(timer)))

      for (const target of document.querySelectorAll(REVEAL_SELECTOR)) {
        if (target.classList.contains('tv-word')) continue
        observer.observe(target)
      }
    }

    // ── Cursor glow ──────────────────────────────────────────────────
    const scope = document.getElementById(scopeId)
    const glow = scope?.querySelector<HTMLElement>('.tv-cursor-glow')
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches

    if (scope && glow && hasFinePointer && !prefersReducedMotion) {
      let frame = 0

      const onMove = (event: PointerEvent) => {
        if (frame) return
        frame = window.requestAnimationFrame(() => {
          frame = 0
          const box = scope.getBoundingClientRect()
          // Outside the hero the orb is not just invisible but unpositioned —
          // fading it out beats letting it sit at the last known edge.
          const inside =
            event.clientY >= box.top && event.clientY <= box.bottom
          glow.style.opacity = inside ? '1' : '0'
          if (!inside) return
          glow.style.setProperty('--tv-cursor-x', `${event.clientX - box.left}px`)
          glow.style.setProperty('--tv-cursor-y', `${event.clientY - box.top}px`)
        })
      }

      window.addEventListener('pointermove', onMove, { passive: true })
      cleanups.push(() => {
        window.removeEventListener('pointermove', onMove)
        if (frame) window.cancelAnimationFrame(frame)
      })
    }

    return () => cleanups.forEach((cleanup) => cleanup())
  }, [scopeId])

  return null
}
