// app/admin/nfc/_components/CopyButton.tsx
'use client'

import { useState } from 'react'

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 900)
        } catch {
          // ignore
        }
      }}
      className="tap-target inline-flex h-8 items-center justify-center rounded-lg border border-white/15 bg-bgSecondary px-2 text-xs font-semibold text-textPrimary hover:bg-white/10 active:bg-white/15"
      aria-label="Copy to clipboard"
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
