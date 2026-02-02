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
      className="inline-flex h-8 items-center justify-center rounded-lg border border-neutral-200 bg-white px-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 active:bg-neutral-100"
      aria-label="Copy to clipboard"
      title={copied ? 'Copied' : 'Copy'}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
