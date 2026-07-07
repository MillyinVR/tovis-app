'use client'

// Owner-only controls on a board detail page (social-first D3): flip a board
// between Private and Shared, and — once Shared — copy its public
// /u/[handle]/boards/[slug] link. Talks to PATCH /api/v1/boards/[id].

import { useState } from 'react'

import type { BoardVisibility } from '@prisma/client'
import { cn } from '@/lib/utils'

type BoardShareControlsProps = {
  boardId: string
  slug: string
  initialVisibility: BoardVisibility
  /** Owner's public handle, or null when they haven't claimed one yet. */
  handle: string | null
}

export default function BoardShareControls({
  boardId,
  slug,
  initialVisibility,
  handle,
}: BoardShareControlsProps) {
  const [visibility, setVisibility] = useState<BoardVisibility>(initialVisibility)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const isShared = visibility === 'SHARED'
  const publicPath = `/u/${handle ?? ''}/boards/${slug}`

  async function setVisibilityTo(next: BoardVisibility) {
    if (busy || next === visibility) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const res = await fetch(`/api/v1/boards/${encodeURIComponent(boardId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: next }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(data?.error || 'Could not update the board.')
      }
      setVisibility(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the board.')
    } finally {
      setBusy(false)
    }
  }

  async function copyShareLink() {
    if (!handle) return
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}${publicPath}`
        : publicPath
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy the link.')
    }
  }

  return (
    <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-textPrimary">
            {isShared ? 'Shared board' : 'Private board'}
          </div>
          <div className="mt-0.5 text-[12px] text-textSecondary">
            {isShared
              ? 'Anyone with the link can see this board.'
              : 'Only you can see this board.'}
          </div>
        </div>

        <div className="inline-flex rounded-full border border-white/15 p-0.5">
          {(['PRIVATE', 'SHARED'] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => setVisibilityTo(option)}
              className={cn(
                'rounded-full px-3 py-1.5 text-[12px] font-black transition disabled:cursor-not-allowed disabled:opacity-60',
                visibility === option
                  ? 'bg-accentPrimary text-bgPrimary'
                  : 'text-textSecondary hover:text-textPrimary',
              )}
            >
              {option === 'PRIVATE' ? 'Private' : 'Shared'}
            </button>
          ))}
        </div>
      </div>

      {isShared ? (
        <div className="mt-4 border-t border-white/10 pt-3">
          {handle ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={copyShareLink}
                className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-bold text-textPrimary transition hover:border-white/20"
              >
                {copied ? 'Link copied ✓' : 'Copy share link'}
              </button>
              <a
                href={publicPath}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[12px] text-textSecondary underline-offset-2 hover:text-textPrimary hover:underline"
              >
                {publicPath}
              </a>
            </div>
          ) : (
            <div className="text-[12px] text-textSecondary">
              Claim a public handle on your{' '}
              <a
                href="/client/me"
                className="font-bold text-textPrimary underline-offset-2 hover:underline"
              >
                profile
              </a>{' '}
              to get a shareable link for this board.
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 text-[12px] text-toneDanger">{error}</div>
      ) : null}
    </section>
  )
}
