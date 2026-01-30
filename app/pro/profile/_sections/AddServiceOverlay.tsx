'use client'

import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ServicePicker from '@/app/pro/services/ServicePicker'

type ServiceDTO = {
  id: string
  name: string
  minPrice: string
  defaultDurationMinutes: number
  defaultImageUrl?: string | null
  isAddOnEligible: boolean
  addOnGroup?: string | null
}

type CategoryDTO = {
  id: string
  name: string
  services: ServiceDTO[]
  children: { id: string; name: string; services: ServiceDTO[] }[]
}

type OfferingDTO = {
  id: string
  serviceId: string
}

export default function AddServiceOverlay(props: {
  open: boolean
  onClose: () => void
  categories: CategoryDTO[]
  offerings: OfferingDTO[]
}) {
  const { open, onClose, categories, offerings } = props
  const panelRef = useRef<HTMLDivElement | null>(null)

  const footerSpacePx = useMemo(() => {
    if (typeof document === 'undefined') return 0
    const v = getComputedStyle(document.documentElement).getPropertyValue('--app-footer-space').trim()
    const n = Number.parseFloat(v.replace('px', ''))
    return Number.isFinite(n) ? n : 0
  }, [])

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    setTimeout(() => panelRef.current?.focus(), 0)

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  const bottomInset = `calc(env(safe-area-inset-bottom) + ${footerSpacePx}px + 12px)`

  const overlayFade = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.18, ease: 'easeOut' } },
    exit: { opacity: 0, transition: { duration: 0.14, ease: 'easeIn' } },
  } as const

  const panelSlide = {
    initial: { opacity: 0, y: 18, scale: 0.996 },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 },
    },
    exit: { opacity: 0, y: 14, transition: { duration: 0.14, ease: 'easeIn' } },
  } as const

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="add-service-overlay"
          className="fixed inset-0 z-[1000]"
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {/* Backdrop: darker so panel reads clean */}
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-lg"
            variants={overlayFade}
          />

          {/* Panel wrapper */}
          <div
            className={[
              'absolute inset-x-0',
              'mx-auto w-full max-w-5xl px-3',
              'sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-w-[640px] sm:px-0',
            ].join(' ')}
            style={{ bottom: bottomInset, top: undefined }}
          >
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Add a service"
              variants={panelSlide}
              className={[
                'relative outline-none',
                'flex flex-col',
                // ✅ stronger glass = readable
                'tovis-glass-strong tovis-noise overflow-hidden',
                'rounded-[26px]',
                'shadow-[0_50px_160px_rgb(0_0_0/0.78)]',
                'max-h-[78vh]',
                'sm:h-full sm:max-h-none sm:rounded-l-[26px] sm:rounded-r-none',
              ].join(' ')}
            >
              {/* Internal readability scrim (keeps luxury feel but improves contrast) */}
              <div className="pointer-events-none absolute inset-0 tovis-overlay-scrim" />

              {/* Specular layers (premium highlight) */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(900px_320px_at_18%_0%,rgb(255_255_255/0.16),transparent_60%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(700px_320px_at_95%_12%,rgb(var(--accent-primary)/0.14),transparent_55%)]" />
                <div className="absolute inset-0 ring-1 ring-white/10" />
              </div>

              {/* Header (sticky) */}
              <div className="relative sticky top-0 z-10 border-b border-white/12 bg-bgSecondary/80 backdrop-blur-xl">
                <div className="px-4 pt-3">
                  {/* “hardware” handle */}
                  <div className="mx-auto h-1 w-12 rounded-full bg-white/18 shadow-[0_1px_0_rgb(255_255_255/0.18)_inset]" />
                </div>

                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-black tracking-[0.04em] text-textPrimary">Add a service</div>
                    <div className="mt-0.5 text-[12px] text-textSecondary">
                      Pick from the library. Your pricing. Platform-consistent names.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className={[
                      'shrink-0 rounded-full',
                      'border border-white/14 bg-bgPrimary/55',
                      'px-3 py-2 text-[12px] font-black tracking-[0.06em] text-textPrimary',
                      'hover:border-white/26 hover:bg-bgPrimary/70',
                      'active:scale-[0.98] transition',
                    ].join(' ')}
                  >
                    Done
                  </button>
                </div>
              </div>

              {/* Scroll body */}
              <div
                className={[
                  'relative flex-1 min-h-0',
                  'overflow-y-auto',
                  'overlayScroll looksNoScrollbar',
                ].join(' ')}
                style={{
                  paddingBottom: `calc(env(safe-area-inset-bottom) + ${footerSpacePx}px + 96px)`,
                }}
              >
                <div className="p-4">
                  {/* Inner frame = boutique card */}
                  <div className="rounded-[22px] border border-white/12 bg-bgPrimary/25 p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.10)]">
                    <ServicePicker categories={categories} offerings={offerings} />
                  </div>
                </div>
              </div>

              {/* Bottom fade (depth) */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-black/35" />
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
