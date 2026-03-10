'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'

export default function RouteOverlay(props: {
  children: ReactNode
  title: string
  subtitle?: string
}) {
  const { children, title, subtitle } = props
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement | null>(null)

  const footerSpacePx = useMemo(() => {
    if (typeof document === 'undefined') return 0
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue('--app-footer-space')
      .trim()
    const n = Number.parseFloat(v.replace('px', ''))
    return Number.isFinite(n) ? n : 0
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.back()
    }

    window.addEventListener('keydown', onKey)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    setTimeout(() => panelRef.current?.focus(), 0)

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [router])

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
      <motion.div
        key="route-overlay"
        className="fixed inset-0 z-[1000]"
        initial="initial"
        animate="animate"
        exit="exit"
      >
        <motion.button
          type="button"
          aria-label="Close"
          onClick={() => router.back()}
          className="absolute inset-0 bg-black/80 backdrop-blur-lg"
          variants={overlayFade}
        />

        <div
          className={[
            'absolute inset-x-0',
            'mx-auto w-full max-w-5xl px-3',
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-w-[720px] sm:px-0',
          ].join(' ')}
          style={{ bottom: bottomInset, top: undefined }}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            variants={panelSlide}
            className={[
              'relative outline-none',
              'flex flex-col',
              'tovis-glass-strong tovis-noise overflow-hidden',
              'rounded-[26px]',
              'shadow-[0_50px_160px_rgb(0_0_0/0.78)]',
              'max-h-[88vh]',
              'sm:h-full sm:max-h-none sm:rounded-l-[26px] sm:rounded-r-none',
            ].join(' ')}
          >
            <div className="pointer-events-none absolute inset-0 tovis-overlay-scrim" />

            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[radial-gradient(900px_320px_at_18%_0%,rgb(255_255_255/0.16),transparent_60%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(700px_320px_at_95%_12%,rgb(var(--accent-primary)/0.14),transparent_55%)]" />
              <div className="absolute inset-0 ring-1 ring-white/10" />
            </div>

            <div className="relative sticky top-0 z-10 border-b border-white/12 bg-bgSecondary/80 backdrop-blur-xl">
              <div className="px-4 pt-3">
                <div className="mx-auto h-1 w-12 rounded-full bg-white/18 shadow-[0_1px_0_rgb(255_255_255/0.18)_inset]" />
              </div>

              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-black tracking-[0.04em] text-textPrimary">
                    {title}
                  </div>
                  {subtitle ? (
                    <div className="mt-0.5 text-[12px] text-textSecondary">
                      {subtitle}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => router.back()}
                  className={[
                    'shrink-0 rounded-full',
                    'border border-white/14 bg-bgPrimary/55',
                    'px-3 py-2 text-[12px] font-black tracking-[0.06em] text-textPrimary',
                    'hover:border-white/26 hover:bg-bgPrimary/70',
                    'active:scale-[0.98] transition',
                  ].join(' ')}
                >
                  Close
                </button>
              </div>
            </div>

            <div
              className={[
                'relative flex-1 min-h-0 overflow-y-auto',
                'overlayScroll looksNoScrollbar',
              ].join(' ')}
              style={{
                paddingBottom: `calc(env(safe-area-inset-bottom) + ${footerSpacePx}px + 32px)`,
              }}
            >
              <div className="p-4">{children}</div>
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-black/35" />
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}