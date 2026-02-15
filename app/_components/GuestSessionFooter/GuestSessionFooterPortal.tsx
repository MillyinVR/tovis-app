// app/_components/GuestSessionFooter/GuestSessionFooterPortal.tsx
'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import GuestSessionFooter from './GuestSessionFooter'

const ROOT_ID = 'tovis-guest-footer-root'

function applyRootStyles(el: HTMLElement) {
  el.style.position = 'fixed'
  el.style.left = '0'
  el.style.right = '0'
  el.style.bottom = '0'
  el.style.width = '100%'
  el.style.zIndex = '999999'
  // allow clicks only inside the rendered footer container
  el.style.pointerEvents = 'none'
}

export default function GuestSessionFooterPortal() {
  const [root, setRoot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let el = document.getElementById(ROOT_ID) as HTMLElement | null
    if (!el) {
      el = document.createElement('div')
      el.id = ROOT_ID
      document.body.appendChild(el)
    }

    applyRootStyles(el)
    setRoot(el)

    // IMPORTANT: don't remove the node on cleanup (HMR/dev can explode)
    return () => {}
  }, [])

  if (!root) return null

  return createPortal(
    <div style={{ pointerEvents: 'auto' }}>
      <GuestSessionFooter />
    </div>,
    root,
  )
}