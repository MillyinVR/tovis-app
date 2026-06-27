// app/pro/verification/DeleteDocButton.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'

type DeleteDocButtonProps = {
  docId: string
}

export default function DeleteDocButton({ docId }: DeleteDocButtonProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="grid justify-items-end gap-1">
      <button
        type="button"
        disabled={deleting}
        onClick={async () => {
          if (typeof window === 'undefined') return
          const ok = window.confirm('Remove this document? You can upload a replacement after.')
          if (!ok) return

          setError(null)
          setDeleting(true)
          try {
            const res = await fetch(`/api/v1/pro/verification-docs/${docId}`, {
              method: 'DELETE',
            })

            const raw = await safeJson(res)
            if (!res.ok || !isRecord(raw) || raw.ok !== true) {
              const msg = isRecord(raw) && typeof raw.error === 'string' ? raw.error : 'Could not remove document.'
              throw new Error(msg)
            }

            router.refresh()
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not remove document.')
          } finally {
            setDeleting(false)
          }
        }}
        className={cn(
          'rounded-full border border-surfaceGlass/14 bg-bgPrimary/25 px-2.5 py-1 text-[11px] font-black text-textSecondary transition',
          'hover:border-toneDanger/35 hover:text-toneDanger',
          deleting && 'cursor-not-allowed opacity-60',
        )}
      >
        {deleting ? 'Removing…' : 'Remove'}
      </button>

      {error ? (
        <div className="text-[11px] font-black text-toneDanger">{error}</div>
      ) : null}
    </div>
  )
}
