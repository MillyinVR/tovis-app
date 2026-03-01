// app/_components/FooterPortal.tsx
'use client'

import { createPortal } from 'react-dom'

const ROOT_ID = 'tovis-footer-root'

export function FooterPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  const root = document.getElementById(ROOT_ID)
  if (!root) return null // should never happen if layout is correct

  return createPortal(children, root)
}