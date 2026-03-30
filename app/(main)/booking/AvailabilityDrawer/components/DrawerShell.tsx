// app/(main)/booking/AvailabilityDrawer/components/DrawerShell.tsx
'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { SHEET_MAX_W, SHEET_SIDE_PAD } from '../constants'

export default function DrawerShell({
  open,
  onClose,
  header,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  header: React.ReactNode
  children: React.ReactNode
  footer: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      // Trigger slide-up on the next frame so the initial off-screen style
      // is painted first, giving the browser something to transition from.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        setMounted(true)
        raf2 = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    } else {
      // Start exit transition then unmount after it completes.
      const t0 = setTimeout(() => setVisible(false), 0)
      const t1 = setTimeout(() => setMounted(false), 350)
      return () => {
        clearTimeout(t0)
        clearTimeout(t1)
      }
    }
  }, [open])

  if (!mounted || typeof document === 'undefined') return null

  const overlayRootStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 2147483648,
    transform: 'none',
  }

  const scrimStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.68)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    opacity: visible ? 1 : 0,
    transition: 'opacity 220ms ease-out',
  }

  // ✅ Use dynamic footer space (measured by FooterShell) so we never overlap the nav footer.
  const bottomOffset = 'var(--app-footer-space, 0px)'

  const sheetWrapStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    transform: visible
      ? 'translateX(-50%) translateY(0)'
      : 'translateX(-50%) translateY(100%)',
    opacity: visible ? 1 : 0,
    transition:
      'transform 320ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease-out 80ms',
    bottom: bottomOffset,
    width: `min(${SHEET_MAX_W}px, calc(100vw - ${SHEET_SIDE_PAD * 2}px))`,
    height: `calc(100dvh - ${bottomOffset} - 14px)`,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
    boxShadow: '0 -18px 60px rgba(0,0,0,0.70)',
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
  }

  const ui = (
    <div style={overlayRootStyle}>
      <button type="button" aria-label="Close availability" onClick={onClose} style={scrimStyle} />
      <div
        className="tovis-glass"
        style={sheetWrapStyle}
        role="dialog"
        aria-modal="true"
        data-testid="availability-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        {children}
        {footer}
      </div>
    </div>
  )

  return createPortal(ui, document.body)
}