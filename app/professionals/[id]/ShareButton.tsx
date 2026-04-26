// app/professionals/[id]/ShareButton.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useBrand } from '@/lib/brand/BrandProvider'

type ShareButtonVariant = 'pill' | 'icon'

type ShareButtonProps = {
  /**
   * Can be:
   * - full URL: "https://tovis.com/professionals/abc"
   * - relative: "/professionals/abc"
   * - omitted: uses window.location.href
   */
  url?: string
  title?: string
  text?: string
  className?: string
  variant?: ShareButtonVariant
}

type ShareStatus = 'Shared' | 'Copied' | 'Link ready' | 'Could not share'

function resolveShareUrl(rawUrl: string | undefined): string {
  if (typeof window === 'undefined') return ''

  const raw = rawUrl?.trim() ?? ''

  if (!raw) return window.location.href
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/')) return `${window.location.origin}${raw}`

  return `${window.location.origin}/${raw}`
}

function canUseNativeShare(): boolean {
  if (typeof window === 'undefined') return false

  return typeof window.navigator.share === 'function'
}

function canUseClipboard(): boolean {
  if (typeof window === 'undefined') return false

  return typeof window.navigator.clipboard?.writeText === 'function'
}

export default function ShareButton({
  url,
  title,
  text,
  className = '',
  variant = 'pill',
}: ShareButtonProps) {
  const { brand } = useBrand()
  const resolvedTitle = title ?? brand.displayName

  const [status, setStatus] = useState<ShareStatus | null>(null)
  const timerRef = useRef<number | null>(null)

  const shareUrl = useMemo(() => resolveShareUrl(url), [url])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const flash = useCallback((nextStatus: ShareStatus) => {
    setStatus(nextStatus)

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }

    timerRef.current = window.setTimeout(() => {
      setStatus(null)
      timerRef.current = null
    }, 1600)
  }, [])

  const onShare = useCallback(async () => {
    if (!shareUrl) return

    try {
      if (canUseNativeShare()) {
        await window.navigator.share({
          url: shareUrl,
          title: resolvedTitle,
          text,
        })

        flash('Shared')
        return
      }

      if (canUseClipboard()) {
        await window.navigator.clipboard.writeText(shareUrl)

        flash('Copied')
        return
      }

      window.prompt('Copy this link:', shareUrl)
      flash('Link ready')
    } catch {
      flash('Could not share')
    }
  }, [flash, resolvedTitle, shareUrl, text])

  return (
    <div className="grid justify-items-center gap-1">
      <button
        type="button"
        title="Share"
        onClick={onShare}
        className={[buttonClassNameForVariant(variant), className]
          .filter(Boolean)
          .join(' ')}
        aria-label="Share profile"
      >
        <span aria-hidden="true">↗</span>
        {variant === 'pill' ? <span>Share</span> : null}
      </button>

      {status ? (
        <div
          aria-live="polite"
          className="text-[11px] font-semibold text-textSecondary"
        >
          {status}
        </div>
      ) : null}
    </div>
  )
}

function buttonClassNameForVariant(variant: ShareButtonVariant): string {
  if (variant === 'icon') {
    return [
      'brand-button-ghost brand-focus',
      'inline-flex h-10 w-10 items-center justify-center rounded-full',
      'text-[14px] font-black transition',
    ].join(' ')
  }

  return [
    'brand-button-ghost brand-focus',
    'inline-flex items-center gap-2 rounded-full px-3 py-2',
    'text-[12px] font-black transition',
  ].join(' ')
}