// app/(main)/looks/_components/CommentsDrawer.tsx 
'use client'

import { useEffect, useRef } from 'react'
import type { UiComment } from './lookTypes'

export default function CommentsDrawer(props: {
  open: boolean
  onClose: () => void
  loading: boolean
  error: string | null
  comments: UiComment[]
  commentText: string
  setCommentText: (v: string) => void
  posting: boolean
  onPost: () => void
}) {
  const { open, onClose, loading, error, comments, commentText, setCommentText, posting, onPost } = props
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Prevent background scroll + focus input on open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const canPost = !posting && Boolean(commentText.trim())

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-100 bg-overlay/70"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Comments"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 grid max-h-[70dvh] grid-rows-[auto_1fr_auto] gap-2.5 rounded-t-[18px] border border-surfaceGlass/10 bg-bgSecondary p-3 text-textPrimary"
        style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}
      >
        <div className="flex items-center justify-between">
          <div className="font-black">Comments</div>
          <button
            onClick={onClose}
            className="rounded-full px-2 py-1 text-textPrimary/80 hover:bg-surfaceGlass/10"
            aria-label="Close comments"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="looksNoScrollbar overflow-y-auto pr-1">
          {loading ? (
            <div className="text-textSecondary">Loading comments…</div>
          ) : error ? (
            <div className="text-toneDanger">{error}</div>
          ) : comments.length ? (
            <div className="grid gap-2.5">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <div className="h-8 w-8 flex-[0_0_auto] overflow-hidden rounded-full bg-surfaceGlass/10">
                    {c.user.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.user.avatarUrl}
                        alt={`${c.user.displayName} avatar`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[12px] font-extrabold">{c.user.displayName}</div>
                    <div className="whitespace-pre-wrap text-[13px] text-textPrimary/95">{c.body}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-textSecondary">No comments yet. Be the first.</div>
          )}
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && canPost) onPost()
            }}
            placeholder="Add a comment…"
            className="flex-1 rounded-full border border-surfaceGlass/15 bg-surfaceGlass/10 px-3 py-2.5 text-[13px] text-textPrimary outline-none placeholder:text-textSecondary/70 backdrop-blur-xl"
          />
          <button
            onClick={onPost}
            disabled={!canPost}
            type="button"
            className={[
              'rounded-full px-3.5 py-2.5 font-black transition',
              !canPost
                ? 'cursor-not-allowed bg-bgPrimary/60 text-textPrimary/70'
                : 'cursor-pointer bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
            ].join(' ')}
          >
            {posting ? '…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
