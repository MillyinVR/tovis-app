// app/pro/ProComplianceBanner.tsx
'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

type BannerKind = 'MISSING_DOC' | 'PENDING_REVIEW' | 'EXPIRING_SOON' | 'EXPIRED'

type SummaryOk = {
  ok: true
  professionalId: string
  kind: BannerKind | null
  expiresInDays: number | null
}

function isSummaryOk(value: unknown): value is SummaryOk {
  if (!value || typeof value !== 'object') return false

  const record = value as Record<string, unknown>

  if (record.ok !== true) return false
  if (typeof record.professionalId !== 'string') return false

  const kind = record.kind
  const expiresInDays = record.expiresInDays

  const validKind =
    kind === null ||
    kind === 'MISSING_DOC' ||
    kind === 'PENDING_REVIEW' ||
    kind === 'EXPIRING_SOON' ||
    kind === 'EXPIRED'

  const validExpiresInDays =
    expiresInDays === null ||
    (typeof expiresInDays === 'number' && Number.isFinite(expiresInDays))

  return validKind && validExpiresInDays
}

function setBannerPx(px: number): void {
  document.documentElement.style.setProperty(
    '--pro-banner-h',
    `${Math.max(0, Math.round(px))}px`,
  )
}

function readDismissed(dismissKey: string | null): boolean {
  if (!dismissKey) return false
  if (typeof window === 'undefined') return false

  try {
    return window.localStorage.getItem(dismissKey) === '1'
  } catch {
    return false
  }
}

function writeDismissed(dismissKey: string | null): void {
  if (!dismissKey) return

  try {
    window.localStorage.setItem(dismissKey, '1')
  } catch {
    // Best-effort browser storage only.
  }
}

function messageForKind(args: {
  kind: BannerKind
  expiresInDays: number | null
}): string {
  const { kind, expiresInDays } = args

  if (kind === 'MISSING_DOC') {
    return 'Finish verification: upload your license or certificate to get approved and appear in the marketplace.'
  }

  if (kind === 'PENDING_REVIEW') {
    return 'Verification is in review. You can keep setting up services + calendar while we check it.'
  }

  if (kind === 'EXPIRED') {
    return 'Your license has expired — renew it, then update your license info to stay active.'
  }

  return `Your license expires in ${expiresInDays ?? '?'} day${
    expiresInDays === 1 ? '' : 's'
  }. Renew it and update your license info before it lapses.`
}

function toneForKind(kind: BannerKind): string {
  if (kind === 'EXPIRED' || kind === 'MISSING_DOC') {
    return 'border-toneDanger/35 bg-bgSecondary/98'
  }

  if (kind === 'EXPIRING_SOON') {
    return 'border-toneWarn/35 bg-bgSecondary/98'
  }

  return 'border-white/10 bg-bgSecondary/98'
}

export default function ProComplianceBanner() {
  const ref = useRef<HTMLDivElement | null>(null)

  const [summary, setSummary] = useState<SummaryOk | null>(null)

  /**
   * Local UI-only dismissals.
   * This avoids the forbidden “read localStorage then setState in an effect”
   * pattern. We derive the persisted dismissal during render, and only store
   * user clicks here.
   */
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )

  useEffect(() => {
    let cancelled = false

    async function loadSummary(): Promise<void> {
      try {
        const res = await fetch('/api/pro/compliance/summary', {
          cache: 'no-store',
        })

        const data: unknown = await res.json().catch(() => null)

        if (cancelled) return
        if (!res.ok) return
        if (!isSummaryOk(data)) return

        setSummary(data)
      } catch {
        // Quiet by design. This banner should never break the pro UI.
      }
    }

    void loadSummary()

    return () => {
      cancelled = true
    }
  }, [])

  const dismissKey = useMemo(() => {
    if (!summary?.professionalId || !summary.kind) return null

    return `tovis:pro:complianceBanner:v1:${summary.professionalId}:${summary.kind}`
  }, [summary?.kind, summary?.professionalId])

  const persistedDismissed = readDismissed(dismissKey)
  const locallyDismissed = dismissKey ? dismissedKeys.has(dismissKey) : false

  const kind = summary?.kind ?? null
  // Expiry warnings must keep nagging — they're not dismissible. Other notices
  // (pending review, missing doc) can be dismissed for the session.
  const dismissible = kind !== 'EXPIRED' && kind !== 'EXPIRING_SOON'
  const visible =
    Boolean(kind) && (!dismissible || (!persistedDismissed && !locallyDismissed))

  useEffect(() => {
    const el = ref.current

    if (!visible || !el) {
      setBannerPx(0)
      return
    }

    const update = () => {
      setBannerPx(el.getBoundingClientRect().height)
    }

    update()

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(el)

    return () => {
      resizeObserver.disconnect()
      setBannerPx(0)
    }
  }, [visible])

  if (!visible || !kind) return null

  const msg = messageForKind({
    kind,
    expiresInDays: summary?.expiresInDays ?? null,
  })

  const tone = toneForKind(kind)

  return (
    <div
      ref={ref}
      className={[
        'fixed left-0 right-0 z-45',
        'border-b backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.25)]',
        tone,
      ].join(' ')}
      style={{ top: 48 }}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 py-2">
        <div className="text-xs font-semibold text-textPrimary">{msg}</div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/pro/verification"
            className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-xs font-black text-textPrimary hover:border-white/20"
          >
            {dismissible ? 'Upload' : 'Update license'}
          </Link>

          {dismissible ? (
            <button
              type="button"
              onClick={() => {
                writeDismissed(dismissKey)

                if (dismissKey) {
                  setDismissedKeys((current) => {
                    const next = new Set(current)
                    next.add(dismissKey)
                    return next
                  })
                }

                setBannerPx(0)
              }}
              className="tap-target rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-xs font-black text-textPrimary hover:border-white/20"
              aria-label="Dismiss"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}