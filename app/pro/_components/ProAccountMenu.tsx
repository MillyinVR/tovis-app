// app/pro/_components/ProAccountMenu.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeftRight,
  Clock,
  Eye,
  Gift,
  LogOut,
  MapPin,
  MessageSquare,
  Scissors,
  Sparkles,
  Upload,
  type LucideIcon,
} from 'lucide-react'

import { zClass } from '@/lib/zIndex'
import type { WorkspaceOption } from '@/lib/auth/workspaces'
import SwitchAccountSheet from '@/app/_components/AdminSessionFooter/SwitchAccountSheet'

type Props = {
  businessName?: string | null
  subtitle?: string | null

  publicUrl?: string | null
  looksHref: string
  proServicesHref: string
  uploadHref: string
  messagesHref: string

  /**
   * Workspaces the pro is entitled to switch into (resolved server-side via
   * buildWorkspaceOptions). The "Switch workspace" row only renders when there
   * is somewhere else to go.
   */
  workspaceOptions?: WorkspaceOption[]
}

type MenuItem = {
  label: string
  href: string
  Icon: LucideIcon
  hint: string
}

type MenuSection = {
  label: string
  items: MenuItem[]
}

function useOnClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onOutside: () => void,
) {
  const onOutsideRef = useRef(onOutside)

  useEffect(() => {
    onOutsideRef.current = onOutside
  }, [onOutside])

  useEffect(() => {
    const touchOpts: AddEventListenerOptions = { passive: true }

    function shouldIgnore(event: Event): boolean {
      const element = ref.current
      if (!element) return true

      const target = event.target
      return target instanceof Node && element.contains(target)
    }

    function onMouseDown(event: MouseEvent): void {
      if (shouldIgnore(event)) return
      onOutsideRef.current()
    }

    function onTouchStart(event: TouchEvent): void {
      if (shouldIgnore(event)) return
      onOutsideRef.current()
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('touchstart', onTouchStart, touchOpts)

    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('touchstart', onTouchStart, touchOpts)
    }
  }, [ref])
}

async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
}

const ROW_BASE =
  'group flex w-full items-center gap-3 rounded-[15px] px-3 py-2.5 text-left transition hover:bg-surfaceGlass/5'

export default function ProAccountMenu(props: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)

  const wrapRef = useRef<HTMLDivElement | null>(null)

  useOnClickOutside(wrapRef, () => {
    setOpen(false)
  })

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.documentElement.style.overflow = previousOverflow
    }
  }, [open])

  const sections = useMemo<MenuSection[]>(
    () => [
      {
        label: 'Studio',
        items: [
          {
            label: 'Manage services',
            href: props.proServicesHref,
            Icon: Scissors,
            hint: 'Pricing & availability',
          },
          {
            label: 'Manage locations',
            href: '/pro/locations',
            Icon: MapPin,
            hint: 'Salon, suite & mobile base',
          },
          {
            label: 'Waitlist',
            href: '/pro/waitlist',
            Icon: Clock,
            hint: 'Clients waiting to fill a spot',
          },
        ],
      },
      {
        label: 'Content',
        items: [
          {
            label: 'Looks',
            href: props.looksHref,
            Icon: Sparkles,
            hint: 'Explore & post',
          },
          {
            label: 'Upload',
            href: props.uploadHref,
            Icon: Upload,
            hint: 'Add photos & videos',
          },
          {
            label: 'Messages',
            href: props.messagesHref,
            Icon: MessageSquare,
            hint: 'Inbox',
          },
          {
            label: 'Referral rewards',
            href: '/pro/referral-rewards',
            Icon: Gift,
            hint: 'Reward tiers for referrals',
          },
        ],
      },
    ],
    [
      props.looksHref,
      props.proServicesHref,
      props.uploadHref,
      props.messagesHref,
    ],
  )

  const title = (props.businessName || '').trim()
  const subtitle = (props.subtitle || '').trim()
  const initial = (title || subtitle).replace(/^@/, '').trim().charAt(0).toUpperCase()
  const workspaceOptions = props.workspaceOptions ?? []
  const canSwitchWorkspace = workspaceOptions.length > 1

  const panelBase =
    'absolute right-0 mt-2 w-[min(384px,92vw)] overflow-hidden rounded-[24px] border'
  const panelMotion =
    'origin-top-right transition duration-200 ease-out will-change-transform will-change-opacity'

  async function handleLogout(): Promise<void> {
    setOpen(false)
    await logout()
    router.replace('/login?from=/pro')
    router.refresh()
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={[
          'group tap-target inline-flex h-10 w-10 items-center justify-center',
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
        <span className="text-[18px] leading-none transition group-hover:opacity-90">
          ⋯
        </span>
      </button>

      <div
        className={[
          `fixed inset-0 ${zClass.overlay} transition`,
          open
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0',
        ].join(' ')}
        style={{
          background:
            'radial-gradient(70% 60% at 50% 20%, rgb(var(--surface-glass) / 0.05), transparent 60%), linear-gradient(to bottom, rgb(var(--shadow-color) / 0.45), rgb(var(--shadow-color) / 0.72))',
        }}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <div
        className={[
          zClass.modal,
          panelBase,
          'bg-bgSurface',
          panelMotion,
          open
            ? 'pointer-events-auto opacity-100 scale-[1]'
            : 'pointer-events-none opacity-0 scale-[0.985]',
        ].join(' ')}
        style={{
          borderColor: 'var(--line)',
          boxShadow: 'var(--shadow-strong)',
        }}
        role="menu"
        aria-label="Account actions"
      >
        {/* header */}
        <div className="flex items-center gap-3 px-4.5 pb-4 pt-4.5">
          <div
            className="h-11.5 w-11.5 shrink-0 rounded-full bg-plume p-0.5"
            aria-hidden="true"
          >
            <div className="grid h-full w-full place-items-center rounded-full bg-bgPrimary font-display text-[18px] font-bold text-textPrimary">
              {initial}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-textMuted">
              Account
            </div>

            {title ? (
              <div className="mt-0.5 truncate font-display text-[17px] font-semibold leading-tight text-textPrimary">
                {title}
              </div>
            ) : (
              <div className="mt-0.5 font-display text-[17px] font-semibold leading-tight text-textPrimary">
                Quick actions
              </div>
            )}

            {subtitle ? (
              <div className="mt-0.5 truncate text-[12px] text-textMuted">
                {subtitle}
              </div>
            ) : null}
          </div>

          <span className="shrink-0 rounded-full bg-accentPrimary px-2.5 py-1.25 font-mono text-[9.5px] font-bold tracking-widest text-onAccent">
            PRO
          </span>
        </div>

        {/* primary — view as client */}
        {props.publicUrl ? (
          <div className="px-3 pb-1">
            <Link
              href={props.publicUrl}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={`${ROW_BASE} border border-accentPrimary/30 bg-accentPrimary/10`}
            >
              <span className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-[10px] bg-accentPrimary/20 text-accentPrimary">
                <Eye size={19} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[14.5px] font-semibold text-textPrimary">
                  View as client
                </span>
                <span className="mt-px block truncate text-[12px] text-textMuted">
                  Preview your public profile
                </span>
              </span>
              <span className="shrink-0 text-[17px] text-accentPrimary">›</span>
            </Link>
          </div>
        ) : null}

        {/* grouped sections */}
        {sections.map((section) => (
          <div key={section.label}>
            <div className="px-5.5 pb-1.75 pt-3.5 font-mono text-[9px] uppercase tracking-[0.18em] text-textMuted">
              {section.label}
            </div>

            {section.items.map((item) => (
              <div key={item.href} className="px-2">
                <Link
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={ROW_BASE}
                >
                  <span className="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-[10px] bg-surfaceGlass/6 text-textSecondary">
                    <item.Icon size={19} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[14.5px] font-semibold text-textPrimary">
                      {item.label}
                    </span>
                    <span className="mt-px block truncate text-[12px] text-textMuted">
                      {item.hint}
                    </span>
                  </span>
                  <span className="shrink-0 text-[17px] text-textMuted opacity-0 transition group-hover:opacity-100">
                    ›
                  </span>
                </Link>
              </div>
            ))}
          </div>
        ))}

        {/* footer */}
        <div
          className="mt-2.5 px-3 pb-3 pt-2"
          style={{ borderTop: '1px solid var(--line)' }}
        >
          {canSwitchWorkspace ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setSwitchOpen(true)
              }}
              className={`${ROW_BASE} text-textSecondary`}
            >
              <ArrowLeftRight size={18} aria-hidden="true" className="shrink-0" />
              <span className="flex-1 font-display text-[14px] font-semibold">
                Switch workspace
              </span>
              <span className="shrink-0 text-[17px] text-textMuted">›</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleLogout}
            className={`${ROW_BASE} text-toneDanger`}
          >
            <LogOut size={18} aria-hidden="true" className="shrink-0" />
            <span className="flex-1 font-display text-[14px] font-semibold">
              Sign out
            </span>
          </button>
        </div>
      </div>

      <SwitchAccountSheet
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        options={workspaceOptions}
      />
    </div>
  )
}
