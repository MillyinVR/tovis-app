'use client'

// Recent-reviews list + moderation controls for the admin reviews page. Talks
// to /api/v1/admin/reviews (list/search) and .../reviews/[id]/hidden
// (PUT hide / DELETE unhide) + .../reviews/[id]/reply (DELETE remove reply).

import { useEffect, useState, useTransition } from 'react'

import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

type ModerationRow = {
  reviewId: string
  rating: number
  headline: string | null
  body: string | null
  createdAt: string
  clientLabel: string
  professionalId: string
  proLabel: string
  proHandle: string | null
  hidden: boolean
  hiddenAt: string | null
  hiddenReason: string | null
  proReplyBody: string | null
  proReplyAt: string | null
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : formatInTimeZone(d, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
}

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as {
    error?: string
  } | null
  return data?.error || 'Request failed.'
}

export default function ReviewsAdminClient() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ModerationRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function load(q: string) {
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/admin/reviews?q=${encodeURIComponent(q)}`,
      )
      if (!res.ok) throw new Error(await readError(res))
      const data = (await res.json()) as { items: ModerationRow[] }
      setItems(data.items)
      setLoaded(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Loading reviews failed.')
    }
  }

  useEffect(() => {
    startTransition(() => load(''))
    // Initial recent-reviews load only; searches go through the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function hide(reviewId: string, reason: string) {
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/reviews/${reviewId}/hidden`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      })
      if (!res.ok) throw new Error(await readError(res))
      await load(query)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Hide failed.')
    }
  }

  async function unhide(reviewId: string) {
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/reviews/${reviewId}/hidden`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await readError(res))
      await load(query)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unhide failed.')
    }
  }

  async function removeReply(reviewId: string) {
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/reviews/${reviewId}/reply`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await readError(res))
      await load(query)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Removing the reply failed.')
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          startTransition(() => load(query))
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by pro business, name, or handle…"
          className="w-full max-w-md rounded-card border border-white/15 bg-bgPrimary px-3 py-2 text-[13px] text-textPrimary placeholder:text-textSecondary focus:border-accentPrimary/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-card border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Loading…' : 'Search'}
        </button>
      </form>

      {error ? (
        <div className="mt-3 text-[12px] text-toneDanger">{error}</div>
      ) : null}

      <div className="mt-5 grid gap-3">
        {items.map((item) => (
          <ReviewRow
            key={item.reviewId}
            item={item}
            busy={pending}
            onHide={(reason) =>
              startTransition(() => hide(item.reviewId, reason))
            }
            onUnhide={() => startTransition(() => unhide(item.reviewId))}
            onRemoveReply={() =>
              startTransition(() => removeReply(item.reviewId))
            }
          />
        ))}
        {loaded && items.length === 0 && !error ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary/40 p-4 text-[13px] text-textSecondary">
            No reviews matched.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ReviewRow({
  item,
  busy,
  onHide,
  onUnhide,
  onRemoveReply,
}: {
  item: ModerationRow
  busy: boolean
  onHide: (reason: string) => void
  onUnhide: () => void
  onRemoveReply: () => void
}) {
  const [reason, setReason] = useState('')

  const dateLabel = formatDate(item.createdAt)
  const replyDateLabel = formatDate(item.proReplyAt)

  return (
    <div
      className={`rounded-card border p-4 ${
        item.hidden
          ? 'border-toneWarn/40 bg-bgPrimary/20'
          : 'border-white/10 bg-bgPrimary/40'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-[14px] font-black">{item.proLabel}</span>
          {item.proHandle ? (
            <span className="ml-2 text-[12px] text-textSecondary">
              @{item.proHandle}
            </span>
          ) : null}
          <span className="ml-2 text-[12px] text-textSecondary">
            reviewed by {item.clientLabel}
            {dateLabel ? ` · ${dateLabel}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-black text-accentPrimary">
            {'★'.repeat(Math.max(1, Math.min(5, item.rating)))}{' '}
            {item.rating}/5
          </span>
          {item.hidden ? (
            <span className="rounded-card border border-toneWarn/50 px-2 py-0.5 text-[11px] font-black uppercase text-toneWarn">
              Hidden
            </span>
          ) : null}
        </div>
      </div>

      {item.headline ? (
        <div className="mt-2 text-[13px] font-black">{item.headline}</div>
      ) : null}
      {item.body ? (
        <div className="mt-1 whitespace-pre-wrap text-[13px] text-textSecondary">
          {item.body}
        </div>
      ) : null}

      {item.hidden && item.hiddenReason ? (
        <div className="mt-2 text-[12px] text-toneWarn">
          Hidden: {item.hiddenReason}
        </div>
      ) : null}

      {item.proReplyBody ? (
        <div className="mt-3 rounded-card border border-white/10 bg-bgPrimary/60 p-3">
          <div className="text-[11px] font-black uppercase text-textSecondary">
            Pro reply{replyDateLabel ? ` · ${replyDateLabel}` : ''}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-[13px] text-textSecondary">
            {item.proReplyBody}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onRemoveReply}
            className="mt-2 rounded-card border border-white/15 bg-bgPrimary px-3 py-1.5 text-[12px] font-black text-toneDanger transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Remove reply
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.hidden ? (
          <button
            type="button"
            disabled={busy}
            onClick={onUnhide}
            className="rounded-card border border-accentPrimary/60 bg-accentPrimary px-3 py-1.5 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            Unhide
          </button>
        ) : (
          <>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="min-w-[160px] flex-1 rounded-card border border-white/15 bg-bgPrimary px-2 py-1.5 text-[12px] text-textPrimary placeholder:text-textSecondary"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => onHide(reason.trim())}
              className="rounded-card border border-white/15 bg-bgPrimary px-3 py-1.5 text-[12px] font-black text-toneDanger transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Hide review
            </button>
          </>
        )}
      </div>
    </div>
  )
}
