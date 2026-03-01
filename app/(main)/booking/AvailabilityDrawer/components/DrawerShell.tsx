// app/(main)/booking/AvailabilityDrawer/components/DrawerShell.tsx
'use client'

import { createPortal } from 'react-dom'
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
  if (!open) return null
  if (typeof document === 'undefined') return null

  const overlayRootStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 2147483647,
    transform: 'none',
  }

  const scrimStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.68)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
  }

  // ✅ Use dynamic footer space (measured by FooterShell) so we never overlap the nav footer.
  const bottomOffset = 'var(--app-footer-space, 0px)'

  const sheetWrapStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
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