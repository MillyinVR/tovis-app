// app/professionals/[id]/ShareButton.tsx

'use client'

import { useEffect, useRef, useState } from 'react'

type SharePayload = { url?: string; title?: string; text?: string }

export default function ShareButton() {
  const [status, setStatus] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  function flash(msg: string) {
    setStatus(msg)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setStatus(null), 2000)
  }

  async function onShare() {
    const url = window.location.href

    try {
      const nav = window.navigator as Navigator & {
        share?: (data: SharePayload) => Promise<void>
        clipboard?: { writeText: (text: string) => Promise<void> }
      }

      // Best UX (mobile etc.)
      if (typeof nav.share === 'function') {
        await nav.share({ url })
        flash('Shared')
        return
      }

      // Clipboard fallback
      if (nav.clipboard?.writeText) {
        await nav.clipboard.writeText(url)
        flash('Copied')
        return
      }

      // Last resort
      window.prompt('Copy this link:', url)
      flash('Link ready')
    } catch {
      flash('Could not share.')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
      <button
        type="button"
        title="Share"
        onClick={onShare}
        style={{
          width: 44,
          height: 36,
          borderRadius: 999,
          border: '1px solid #e5e7eb',
          background: '#fff',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        ↗
      </button>

      {status && (
        <div
          aria-live="polite"
          style={{ fontSize: 11, color: '#6b7280', textAlign: 'center' }}
        >
          {status}
        </div>
      )}
    </div>
  )
}
