// app/_components/ClientSessionFooter/ClientSessionFooterPortal.tsx
'use client'

import { createPortal } from 'react-dom'
import { useLayoutEffect, useState } from 'react'
import ClientSessionFooter from './ClientSessionFooter'

const ROOT_ID = 'tovis-client-footer-root'

function applyRootStyles(el: HTMLElement) {
  el.style.position = 'fixed'
  el.style.left = '0'
  el.style.right = '0'
  el.style.bottom = '0'
  el.style.width = '100%'
  el.style.zIndex = '999999'
  el.style.pointerEvents = 'none'
}

export default function ClientSessionFooterPortal({ inboxBadge }: { inboxBadge?: string | null }) {
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
    const raf = requestAnimationFrame(() => applyRootStyles(el!))

    setRoot(el)

    return () => {
      cancelAnimationFrame(raf)
      if (created && el?.parentNode) el.parentNode.removeChild(el)
    }
  }, [])

  if (!root) return null

  return createPortal(
    <div style={{ pointerEvents: 'auto' }}>
      <ClientSessionFooter inboxBadge={inboxBadge} />
    </div>,
    root,
  )
}
