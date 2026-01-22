// app/professionals/[id]/ShareButton.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type SharePayload = { url?: string; title?: string; text?: string }

export default function ShareButton({
  url,
  title = 'TOVIS',
  text,
  className = '',
  variant = 'pill',
}: {
  /**
   * Can be:
   * - full URL: "https://tovis.com/professionals/abc"
   * - relative: "/professionals/abc"  (we will resolve against window.location.origin)
   * - omitted: uses window.location.href
   */
  url?: string
  title?: string
  text?: string
  className?: string
  /**
   * "pill" = matches your other CTA buttons
   * "icon" = compact, if you want it in a tight header
   */
  variant?: 'pill' | 'icon'
}) {
  const [status, setStatus] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''

    const raw = (url || '').trim()
    if (!raw) return window.location.href

    // If it's already absolute, keep it
    if (/^https?:\/\//i.test(raw)) return raw

    // If it's a relative path, resolve it
    if (raw.startsWith('/')) return `${window.location.origin}${raw}`

    // Otherwise, treat as a path-ish thing and still resolve
    return `${window.location.origin}/${raw}`
  }, [url])

  const flash = useCallback((msg: string) => {
    setStatus(msg)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setStatus(null), 1600)
  }, [])

  const onShare = useCallback(async () => {
    if (!shareUrl) return

    try {
      const nav = window.navigator as Navigator & {
        share?: (data: SharePayload) => Promise<void>
        clipboard?: { writeText: (text: string) => Promise<void> }
      }

      // Best UX (mostly mobile)
      if (typeof nav.share === 'function') {
        await nav.share({ url: shareUrl, title, text })
        flash('Shared')
        return
      }

      // Clipboard fallback (desktop)
      if (nav.clipboard?.writeText) {
        await nav.clipboard.writeText(shareUrl)
        flash('Copied')
        return
      }

      // Last resort
      window.prompt('Copy this link:', shareUrl)
      flash('Link ready')
    } catch {
      flash('Could not share')
    }
  }, [flash, shareUrl, text, title])

  const base =
    variant === 'icon'
      ? [
          'inline-flex h-10 w-10 items-center justify-center rounded-full border transition',
          'border-white/10 bg-bgSecondary text-textPrimary hover:border-white/20 hover:bg-white/10',
        ].join(' ')
      : [
          'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[12px] font-black transition',
          'border-white/10 bg-bgSecondary text-textPrimary hover:border-white/20 hover:bg-white/10',
        ].join(' ')

  return (
    <div className="grid justify-items-center gap-1">
      <button type="button" title="Share" onClick={onShare} className={[base, className].join(' ')}>
        <span aria-hidden="true">↗</span>
        {variant === 'pill' ? <span>Share</span> : null}
      </button>

      {status ? (
        <div aria-live="polite" className="text-[11px] font-semibold text-textSecondary">
          {status}
        </div>
      ) : null}
    </div>
  )
}
