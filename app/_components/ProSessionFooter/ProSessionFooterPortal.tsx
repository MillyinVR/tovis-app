// app/_components/ProSessionFooter/ProSessionFooterPortal.tsx
'use client'

import { createPortal } from 'react-dom'
import { useLayoutEffect, useMemo, useState } from 'react'
import ProSessionFooter from './ProSessionFooter'

const ROOT_ID = 'tovis-pro-footer-root'
const MOUNT_ID = 'tovis-pro-footer-mount'

function applyRootStyles(el: HTMLElement) {
  el.style.position = 'fixed'
  el.style.left = '0'
  el.style.right = '0'
  el.style.bottom = '0'
  el.style.width = '100%'
  el.style.zIndex = '999999'

  // ✅ MUST be clickable (do NOT use pointer-events:none on a parent of interactive UI)
  el.style.pointerEvents = 'auto'

  // Optional: keep it from doing weird layout stuff
  el.style.margin = '0'
  el.style.padding = '0'
}

function applyMountStyles(el: HTMLElement) {
  // ✅ This is the interactive layer
  el.style.pointerEvents = 'auto'
  el.style.width = '100%'
}

export default function ProSessionFooterPortal({ messagesBadge }: { messagesBadge?: string | null }) {
  const [mountEl, setMountEl] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    let root = document.getElementById(ROOT_ID) as HTMLElement | null
    if (!root) {
      root = document.createElement('div')
      root.id = ROOT_ID
      root.setAttribute('data-tovis', 'pro-footer-root')
      document.body.appendChild(root)
    }

    // ✅ Don't aria-hide interactive UI
    root.removeAttribute('aria-hidden')

    applyRootStyles(root)

    let mount = document.getElementById(MOUNT_ID) as HTMLElement | null
    if (!mount) {
      mount = document.createElement('div')
      mount.id = MOUNT_ID
      mount.setAttribute('data-tovis', 'pro-footer-mount')
      root.appendChild(mount)
    }

    applyMountStyles(mount)
    setMountEl(mount)

    return () => {}
  }, [])

  const badge = useMemo(() => messagesBadge ?? null, [messagesBadge])

  if (!mountEl) return null
  return createPortal(<ProSessionFooter messagesBadge={badge} />, mountEl)
}