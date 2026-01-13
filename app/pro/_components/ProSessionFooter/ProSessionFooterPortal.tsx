// app/pro/_components/ProSessionFooter/ProSessionFooterPortal.tsx
'use client'

import { createPortal } from 'react-dom'
import { useLayoutEffect, useState } from 'react'
import ProSessionFooter from './ProSessionFooter'

const ROOT_ID = 'tovis-pro-footer-root'

function applyRootStyles(el: HTMLElement) {
  // The root is the fixed viewport anchor.
  el.style.position = 'fixed'
  el.style.left = '0'
  el.style.right = '0'
  el.style.bottom = '0'
  el.style.width = '100%'

  // High enough to beat app chrome, low enough to not be insane.
  el.style.zIndex = '999999'

  // Allow clicks only inside the actual footer wrapper (child).
  el.style.pointerEvents = 'none'
}

export default function ProSessionFooterPortal() {
  const [root, setRoot] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const host = document.body

    let el = document.getElementById(ROOT_ID) as HTMLElement | null
    let created = false

    if (!el) {
      el = document.createElement('div')
      el.id = ROOT_ID
      host.appendChild(el)
      created = true
    }

    applyRootStyles(el)

    // If something else messes with it after hydration, re-apply once.
    const raf = requestAnimationFrame(() => applyRootStyles(el!))

    setRoot(el)

    return () => {
      cancelAnimationFrame(raf)
      // Only remove if we created it. Don’t delete someone else’s node.
      if (created && el?.parentNode) el.parentNode.removeChild(el)
    }
  }, [])

  if (!root) return null

  return createPortal(
    <div style={{ pointerEvents: 'auto' }}>
      <ProSessionFooter />
    </div>,
    root,
  )
}
