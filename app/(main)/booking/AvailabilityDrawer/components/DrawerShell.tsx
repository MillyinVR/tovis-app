// app/(main)/booking/AvailabilityDrawer/components/DrawerShell.tsx
'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import {
  SHEET_DESKTOP_MARGIN,
  SHEET_MAX_H_DESKTOP,
  SHEET_MAX_W,
  SHEET_SIDE_PAD,
} from '../constants'
import { Z } from '@/lib/zIndex'
import { useMediaQuery } from '@/lib/ui/useMediaQuery'
import { MEDIA } from '@/lib/ui/breakpoints'

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
  const isDesktop = useMediaQuery(MEDIA.desktop)

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
    zIndex: Z.modal,
    transform: 'none',
  }

  const scrimStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: 'rgb(var(--scrim) / 0.68)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    opacity: visible ? 1 : 0,
    transition: 'opacity 220ms ease-out',
  }

  // ✅ Use dynamic footer space (measured by FooterShell) so we never overlap the nav footer.
  const bottomOffset = 'var(--app-footer-space, 0px)'

  const sharedSheetStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    width: `min(${SHEET_MAX_W}px, calc(100vw - ${SHEET_SIDE_PAD * 2}px))`,
    overflow: 'hidden',
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto',
    background: 'rgb(var(--bg-primary))',
  }

  // Below lg (see MEDIA.desktop): the established mobile/tablet bottom
  // sheet — slides up from the footer, fills nearly the full viewport
  // height. At lg+ that composition is a phone-sized card floating in dead
  // scrim (client-parity-brief.md finding #2), so it switches to a real
  // desktop shape instead: a centered dialog capped in BOTH dimensions —
  // same width as the mobile sheet (the audit is explicit that widening it
  // is not the fix), fading + settling into place rather than sliding off
  // the bottom edge, with visible scrim margin on every side the way a
  // floating dialog reads as finished rather than misplaced.
  const sheetWrapStyle: React.CSSProperties = isDesktop
    ? {
        ...sharedSheetStyle,
        top: '50%',
        transform: visible
          ? 'translate(-50%, -50%) scale(1)'
          : 'translate(-50%, -50%) scale(0.96)',
        opacity: visible ? 1 : 0,
        transition:
          'transform 220ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease-out',
        height: `min(${SHEET_MAX_H_DESKTOP}px, calc(100dvh - ${SHEET_DESKTOP_MARGIN * 2}px))`,
        borderRadius: 22,
        boxShadow: '0 24px 80px rgb(var(--shadow-color) / 0.70)',
      }
    : {
        ...sharedSheetStyle,
        bottom: bottomOffset,
        transform: visible
          ? 'translateX(-50%) translateY(0)'
          : 'translateX(-50%) translateY(100%)',
        opacity: visible ? 1 : 0,
        transition:
          'transform 320ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms ease-out 80ms',
        height: `calc(100dvh - ${bottomOffset} - 14px)`,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        boxShadow: '0 -18px 60px rgb(var(--shadow-color) / 0.70)',
      }

  const ui = (
    <div style={overlayRootStyle}>
      <button type="button" aria-label="Close availability" onClick={onClose} style={scrimStyle} />
      <div
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