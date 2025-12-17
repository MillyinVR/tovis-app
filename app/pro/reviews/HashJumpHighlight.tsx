'use client'

import { useEffect } from 'react'

export default function HashJumpHighlight() {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || hash.length < 2) return

    // decode in case ids ever include encoded chars
    const targetId = decodeURIComponent(hash.slice(1))
    const el = document.getElementById(targetId)
    if (!el) return

    // Scroll into view (gives the user the “ohhh it worked” moment)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })

    // Temporary highlight
    const prevTransition = el.style.transition
    const prevBoxShadow = el.style.boxShadow
    const prevBackground = el.style.background

    el.style.transition = 'box-shadow 250ms ease, background 250ms ease'
    el.style.boxShadow = '0 0 0 3px rgba(34,197,94,0.55)'
    el.style.background = 'rgba(34,197,94,0.06)'

    const t1 = window.setTimeout(() => {
      el.style.boxShadow = prevBoxShadow
      el.style.background = prevBackground
    }, 1600)

    const t2 = window.setTimeout(() => {
      el.style.transition = prevTransition
    }, 2200)

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  return null
}
