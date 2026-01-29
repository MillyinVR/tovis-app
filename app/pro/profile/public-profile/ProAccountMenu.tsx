// app/pro/profile/public-profile/ProAccountMenu.tsx
'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Props = {
  businessName?: string | null
  subtitle?: string | null

  publicUrl: string
  proServicesHref: string
  looksHref: string
  uploadHref: string
  messagesHref: string
}

function useOnClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onOutside: () => void,
) {
  const onOutsideStable = useCallback(onOutside, [onOutside])

  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      const el = ref.current
      if (!el) return
      const target = e.target as Node | null
      if (target && el.contains(target)) return
      onOutsideStable()
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })

    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown as any)
    }
  }, [ref, onOutsideStable])
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
}

export default function ProAccountMenu(props: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOnClickOutside(wrapRef, () => setOpen(false))

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    // Prevent accidental background scroll when menu open (lux feel)
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prev
    }
  }, [open])

  const items = useMemo(
    () => [
      { label: 'View as client', href: props.publicUrl, emoji: '👀', hint: 'See what clients see' },
      { label: 'Looks', href: props.looksHref, emoji: '✨', hint: 'Explore & post' },
      { label: 'Manage services', href: props.proServicesHref, emoji: '🧾', hint: 'Edit pricing & availability' },
      { label: 'Upload', href: props.uploadHref, emoji: '⬆️', hint: 'Add photos/videos' },
      { label: 'Messages', href: props.messagesHref, emoji: '💬', hint: 'Inbox' },
    ],
    [props.publicUrl, props.looksHref, props.proServicesHref, props.uploadHref, props.messagesHref],
  )

  const title = (props.businessName || '').trim()
  const subtitle = (props.subtitle || '').trim()

  // Panel skin (no hex)
  const panelBase =
    'absolute right-0 mt-2 w-[min(360px,90vw)] overflow-hidden rounded-[18px] border border-white/10'
  const panelSkin = 'bg-bgPrimary/70 backdrop-blur'
  const edgeGlow =
    'shadow-[0_0_0_1px_hsl(0_0%_100%_/0.06),0_28px_90px_rgba(0,0,0,0.60)]'
  const panelMotion =
    'origin-top-right transition duration-200 ease-out will-change-transform will-change-opacity'

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          'group inline-flex h-10 w-10 items-center justify-center',
          'rounded-full border border-white/10 bg-bgSecondary',
          'text-textPrimary',
          'hover:border-white/20',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
          'transition',
        ].join(' ')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title="Account"
      >
        <span className="text-[18px] leading-none transition group-hover:opacity-90">⋯</span>
      </button>

      {/* Mounted overlay + panel for smooth animation */}
      {mounted ? (
        <>
          {/* Soft scrim (luxury feel) */}
          <div
            className={[
              'fixed inset-0 z-[9998] transition',
              open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
            ].join(' ')}
            style={{
              background:
                'radial-gradient(70% 60% at 50% 20%, hsl(0 0% 100% / 0.06), transparent 60%), linear-gradient(to bottom, hsl(0 0% 0% / 0.30), hsl(0 0% 0% / 0.55))',
            }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            className={[
              'z-[9999]',
              panelBase,
              panelSkin,
              edgeGlow,
              panelMotion,
              open ? 'pointer-events-auto opacity-100 scale-[1]' : 'pointer-events-none opacity-0 scale-[0.985]',
            ].join(' ')}
            role="menu"
            aria-label="Account actions"
          >
            {/* Header */}
            <div className="px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-extrabold text-textSecondary">Account</div>

                  {title ? (
                    <div className="mt-0.5 truncate text-[14px] font-black text-textPrimary">{title}</div>
                  ) : (
                    <div className="mt-0.5 text-[14px] font-black text-textPrimary">Quick actions</div>
                  )}

                  {subtitle ? (
                    <div className="mt-0.5 truncate text-[11px] font-extrabold text-textSecondary">
                      {subtitle}
                    </div>
                  ) : null}
                </div>

                <span className="shrink-0 rounded-full border border-white/10 bg-bgSecondary/60 px-2 py-1 text-[10px] font-black text-textSecondary">
                  PRO
                </span>
              </div>
            </div>

            <div className="h-px bg-white/10" />

            {/* Items */}
            <div className="grid">
              {items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={[
                    'group flex items-center gap-3 px-3 py-3',
                    'text-[13px] font-black text-textPrimary',
                    'hover:bg-bgSecondary/70',
                    'transition',
                  ].join(' ')}
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-bgSecondary/60 text-[14px]">
                    {it.emoji}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-extrabold text-textSecondary">
                      {it.hint}
                    </span>
                  </span>

                  <span className="text-textSecondary opacity-0 transition group-hover:opacity-100">›</span>
                </Link>
              ))}
            </div>

            <div className="h-px bg-white/10" />

            {/* Sign out */}
            <div className="p-2">
              <button
                type="button"
                onClick={async () => {
                  setOpen(false)
                  await logout()
                  router.replace('/login?from=/pro')
                  router.refresh()
                }}
                className={[
                  'group w-full rounded-[14px] border border-white/10',
                  'bg-bgSecondary/70 px-3 py-3',
                  'text-left text-[13px] font-black',
                  'hover:border-white/20 hover:bg-bgSecondary/85',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
                  'transition',
                ].join(' ')}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-bgPrimary/40">
                    🚪
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="text-toneDanger">Sign out</div>
                    <div className="mt-0.5 text-[11px] font-extrabold text-textSecondary">
                      End your session on this device
                    </div>
                  </div>

                  <span className="text-textSecondary opacity-70 transition group-hover:opacity-100">›</span>
                </div>
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
