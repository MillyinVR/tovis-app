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

type Summary = SummaryOk | { ok: false; error?: string }

function safeString(v: unknown) {
  return typeof v === 'string' ? v : ''
}

function isSummaryOk(x: unknown): x is SummaryOk {
  if (!x || typeof x !== 'object') return false
  const r = x as Record<string, unknown>
  if (r.ok !== true) return false
  return typeof r.professionalId === 'string'
}

function setBannerPx(px: number) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--pro-banner-h', `${Math.max(0, Math.round(px))}px`)
}

export default function ProComplianceBanner() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [summary, setSummary] = useState<SummaryOk | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const dismissKey = useMemo(() => {
    if (!summary?.professionalId || !summary.kind) return null
    return `tovis:pro:complianceBanner:v1:${summary.professionalId}:${summary.kind}`
  }, [summary])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/pro/compliance/summary', { cache: 'no-store' })
        const data: unknown = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !isSummaryOk(data)) return
        setSummary(data)
      } catch {
        // ignore
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!dismissKey) return
    try {
      setDismissed(localStorage.getItem(dismissKey) === '1')
    } catch {
      setDismissed(false)
    }
  }, [dismissKey])

  // Measure + reserve space (only when visible)
  useEffect(() => {
    const el = ref.current
    const visible = Boolean(summary?.kind) && !dismissed
    if (!visible || !el) {
      setBannerPx(0)
      return
    }

    const update = () => setBannerPx(el.getBoundingClientRect().height)

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      ro.disconnect()
      // if we unmount while visible, clear the var
      setBannerPx(0)
    }
  }, [summary?.kind, dismissed])

  const kind = summary?.kind ?? null
  const visible = Boolean(kind) && !dismissed

  if (!visible) return null

  const days = summary?.expiresInDays
  const msg =
    kind === 'MISSING_DOC'
      ? 'Finish verification: upload your license photo to get approved and appear in the marketplace.'
      : kind === 'PENDING_REVIEW'
        ? 'Verification is in review. You can keep setting up services + calendar while we check it.'
        : kind === 'EXPIRED'
          ? 'Your license looks expired. Upload an updated license to stay active.'
          : `Your license expires soon (${days ?? '?'} day${days === 1 ? '' : 's'}). Upload an updated license.`

  const tone =
  kind === 'EXPIRED' || kind === 'MISSING_DOC'
    ? 'border-toneDanger/35 bg-bgSecondary/98'
    : kind === 'EXPIRING_SOON'
      ? 'border-toneWarn/35 bg-bgSecondary/98'
      : 'border-white/10 bg-bgSecondary/98'

  

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
            Upload
          </Link>

          <button
            type="button"
            onClick={() => {
              if (dismissKey) {
                try {
                  localStorage.setItem(dismissKey, '1')
                } catch {
                  // ignore
                }
              }
              setDismissed(true)
              setBannerPx(0)
            }}
            className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-xs font-black text-textPrimary hover:border-white/20"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}