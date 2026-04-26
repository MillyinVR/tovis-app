// app/pro/profile/public-profile/ShareButton.tsx
'use client'

import { useEffect, useRef, useState } from 'react'

type ShareButtonProps = {
  url: string
  label?: string
}

type ShareStatus = 'idle' | 'copied' | 'error'

type TimeoutHandle = ReturnType<typeof setTimeout>

function resolveShareUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  if (typeof window === 'undefined') return trimmed

  try {
    return new URL(trimmed, window.location.origin).toString()
  } catch {
    return trimmed
  }
}

export default function ShareButton({
  url,
  label = 'Share profile',
}: ShareButtonProps) {
  const resetTimerRef = useRef<TimeoutHandle | null>(null)

  const [sharing, setSharing] = useState(false)
  const [status, setStatus] = useState<ShareStatus>('idle')

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  function scheduleStatusReset() {
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current)
    }

    resetTimerRef.current = setTimeout(() => {
      setStatus('idle')
      resetTimerRef.current = null
    }, 1800)
  }

  async function share() {
    if (sharing) return

    const shareUrl = resolveShareUrl(url)
    if (!shareUrl) {
      setStatus('error')
      scheduleStatusReset()
      return
    }

    setSharing(true)
    setStatus('idle')

    try {
      if (navigator.share) {
        await navigator.share({ url: shareUrl })
        return
      }

      if (!navigator.clipboard) {
        setStatus('error')
        scheduleStatusReset()
        return
      }

      await navigator.clipboard.writeText(shareUrl)
      setStatus('copied')
      scheduleStatusReset()
    } catch {
      setStatus('error')
      scheduleStatusReset()
    } finally {
      setSharing(false)
    }
  }

  const statusText =
    status === 'copied'
      ? 'Link copied'
      : status === 'error'
        ? 'Could not share link'
        : ''

  return (
    <span className="brand-share-button-wrap">
      <button
        type="button"
        onClick={share}
        disabled={sharing}
        className="brand-share-button brand-focus"
        title={label}
        aria-label={label}
      >
        <span aria-hidden="true">↗</span>
      </button>

      <span className="brand-share-button-status" aria-live="polite">
        {statusText}
      </span>
    </span>
  )
}