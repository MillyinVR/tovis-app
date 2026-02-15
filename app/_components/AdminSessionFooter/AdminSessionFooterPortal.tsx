// app/_components/AdminSessionFooter/AdminSessionFooterPortal.tsx
'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import AdminSessionFooter from './AdminSessionFooter'

const ROOT_ID = 'tovis-admin-footer-root'

function applyRootStyles(el: HTMLElement) {
  el.style.position = 'fixed'
  el.style.left = '0'
  el.style.right = '0'
  el.style.bottom = '0'
  el.style.width = '100%'
  el.style.zIndex = '999999'
  el.style.pointerEvents = 'none'
}

export default function AdminSessionFooterPortal({ supportBadge }: { supportBadge?: string | null }) {
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
      <AdminSessionFooter supportBadge={supportBadge ?? null} />
    </div>,
    root,
  )
}
