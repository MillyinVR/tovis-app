// app/(main)/looks/_components/CommentsDrawer.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Heart, User as UserIcon, X } from 'lucide-react'

import { initialsForName } from '@/lib/initials'
import { formatRelativeTimeCompact } from '@/lib/time/relativeTime'
import { useLookComments } from './useLookComments'
import type { UiComment } from './lookTypes'

const LIKED_COLOR = 'rgb(var(--color-ember))'

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function CommentAvatar({
  displayName,
  avatarUrl,
  size,
}: {
  displayName: string
  avatarUrl: string | null
  size: number
}) {
  return (
    <div
      className="flex-[0_0_auto] overflow-hidden rounded-full bg-surfaceGlass/15"
      style={{ width: size, height: size }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={`${displayName} avatar`}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div
          aria-hidden="true"
          className="grid h-full w-full place-items-center font-extrabold text-textPrimary/80"
          style={{ fontSize: Math.round(size * 0.4) }}
        >
          {initialsForName(displayName, '?')}
        </div>
      )}
    </div>
  )
}

function CommentRow({
  comment,
  depth,
  onToggleLike,
  onReply,
  onDelete,
  onReport,
}: {
  comment: UiComment
  depth: 0 | 1
  onToggleLike: (comment: UiComment) => void
  onReply: (comment: UiComment) => void
  onDelete: (comment: UiComment) => void
  onReport: (comment: UiComment) => Promise<'ok' | 'auth' | 'error'>
}) {
  const [reportState, setReportState] = useState<'idle' | 'pending' | 'done'>(
    'idle',
  )

  async function handleReport() {
    if (reportState !== 'idle') return
    setReportState('pending')
    const result = await onReport(comment)
    setReportState(result === 'ok' ? 'done' : 'idle')
  }

  function handleDelete() {
    if (typeof window !== 'undefined') {
      const ok = window.confirm('Delete this comment?')
      if (!ok) return
    }
    onDelete(comment)
  }

  return (
    <div className="flex gap-2.5">
      <CommentAvatar
        displayName={comment.user.displayName}
        avatarUrl={comment.user.avatarUrl}
        size={depth === 0 ? 36 : 28}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[12.5px] font-extrabold text-textPrimary">
            {comment.user.displayName}
          </span>
          <span className="flex-[0_0_auto] text-[11px] text-textSecondary">
            {formatRelativeTimeCompact(comment.createdAt)}
          </span>
        </div>

        <div className="whitespace-pre-wrap wrap-break-word text-[13px] leading-snug text-textPrimary/95">
          {comment.body}
        </div>

        <div className="mt-1 flex items-center gap-3.5 text-[11px] font-bold text-textSecondary">
          <button
            type="button"
            onClick={() => onReply(comment)}
            className="hover:text-textPrimary"
          >
            Reply
          </button>

          {comment.viewerCanDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              className="hover:text-toneDanger"
            >
              Delete
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReport}
              disabled={reportState !== 'idle'}
              className="disabled:opacity-60 hover:text-textPrimary"
            >
              {reportState === 'done'
                ? 'Reported'
                : reportState === 'pending'
                  ? 'Reporting…'
                  : 'Report'}
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onToggleLike(comment)}
        aria-label={comment.viewerLiked ? 'Unlike comment' : 'Like comment'}
        aria-pressed={comment.viewerLiked}
        className="flex w-7 flex-[0_0_auto] flex-col items-center gap-0.5 self-start pt-0.5 active:scale-90"
      >
        <Heart
          size={16}
          style={{
            color: comment.viewerLiked ? LIKED_COLOR : undefined,
            fill: comment.viewerLiked ? LIKED_COLOR : 'none',
          }}
          className={comment.viewerLiked ? '' : 'text-textSecondary'}
        />
        <span className="text-[10px] font-bold text-textSecondary">
          {comment.likeCount > 0 ? formatCount(comment.likeCount) : ''}
        </span>
      </button>
    </div>
  )
}

export default function CommentsDrawer({
  lookPostId,
  open,
  onClose,
  onCountChange,
  onRequireAuth,
}: {
  lookPostId: string | null
  open: boolean
  onClose: () => void
  onCountChange: (lookPostId: string, commentsCount: number) => void
  onRequireAuth: (reason: string) => void
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const {
    comments,
    commentsCount,
    loading,
    error,
    text,
    setText,
    posting,
    replyTo,
    setReplyTo,
    getThread,
    toggleReplies,
    post,
    toggleLike,
    remove,
    report,
  } = useLookComments({
    lookPostId: open ? lookPostId : null,
    onCountChange,
    onRequireAuth,
  })

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const canPost = !posting && Boolean(text.trim())

  function startReply(comment: UiComment) {
    const parentId = comment.parentCommentId ?? comment.id
    setReplyTo({ parentId, displayName: comment.user.displayName })
    setText((current) =>
      current.trim() ? current : `@${comment.user.displayName} `,
    )
    inputRef.current?.focus()
  }

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
        className="absolute bottom-0 left-0 right-0 grid max-h-[78dvh] grid-rows-[auto_auto_1fr_auto] rounded-t-card border border-surfaceGlass/10 bg-bgSecondary text-textPrimary"
        style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 10px)` }}
      >
        {/* Grabber */}
        <div className="flex justify-center pb-1 pt-2.5">
          <div className="h-1 w-9 rounded-full bg-textSecondary/40" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-surfaceGlass/10 px-3 pb-2">
          <div className="text-[14px] font-black">
            {commentsCount > 0
              ? `${formatCount(commentsCount)} comment${commentsCount === 1 ? '' : 's'}`
              : 'Comments'}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-textPrimary/80 hover:bg-surfaceGlass/10"
            aria-label="Close comments"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* List */}
        <div className="looksNoScrollbar overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="text-textSecondary">Loading comments…</div>
          ) : error ? (
            <div className="text-toneDanger">{error}</div>
          ) : comments.length ? (
            <div className="grid gap-4">
              {comments.map((c) => {
                const thread = getThread(c.id)
                return (
                  <div key={c.id} className="grid gap-2.5">
                    <CommentRow
                      comment={c}
                      depth={0}
                      onToggleLike={toggleLike}
                      onReply={startReply}
                      onDelete={remove}
                      onReport={report}
                    />

                    {c.replyCount > 0 || thread.replies.length > 0 ? (
                      <div className="pl-11.5">
                        <button
                          type="button"
                          onClick={() => void toggleReplies(c.id)}
                          className="flex items-center gap-2 text-[11.5px] font-bold text-textSecondary hover:text-textPrimary"
                        >
                          <span className="h-px w-5 bg-textSecondary/40" />
                          {thread.open
                            ? 'Hide replies'
                            : `View ${formatCount(c.replyCount)} ${c.replyCount === 1 ? 'reply' : 'replies'}`}
                        </button>

                        {thread.open ? (
                          <div className="mt-3 grid gap-3.5">
                            {thread.loading ? (
                              <div className="text-[12px] text-textSecondary">
                                Loading replies…
                              </div>
                            ) : thread.error ? (
                              <div className="text-[12px] text-toneDanger">
                                {thread.error}
                              </div>
                            ) : (
                              thread.replies.map((r) => (
                                <CommentRow
                                  key={r.id}
                                  comment={r}
                                  depth={1}
                                  onToggleLike={toggleLike}
                                  onReply={startReply}
                                  onDelete={remove}
                                  onReport={report}
                                />
                              ))
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-textSecondary">No comments yet. Be the first.</div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-surfaceGlass/10 px-3 pt-2.5">
          {replyTo ? (
            <div className="mb-2 flex items-center justify-between rounded-lg bg-surfaceGlass/10 px-3 py-1.5 text-[12px] text-textSecondary">
              <span className="truncate">
                Replying to{' '}
                <span className="font-bold text-textPrimary">
                  {replyTo.displayName}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
                className="ml-2 rounded-full p-0.5 hover:text-textPrimary"
              >
                <X size={14} />
              </button>
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <div className="grid h-9 w-9 flex-[0_0_auto] place-items-center overflow-hidden rounded-full bg-surfaceGlass/15 text-textSecondary">
              <UserIcon size={18} aria-hidden="true" />
            </div>

            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (canPost) void post()
                }
              }}
              rows={1}
              placeholder={replyTo ? 'Add a reply…' : 'Add a comment…'}
              className="max-h-24 min-h-10 flex-1 resize-none rounded-2xl border border-surfaceGlass/15 bg-surfaceGlass/10 px-3 py-2.5 text-[13px] text-textPrimary outline-none placeholder:text-textSecondary/70"
            />

            <button
              onClick={() => void post()}
              disabled={!canPost}
              type="button"
              className={[
                'flex-[0_0_auto] rounded-full px-4 py-2.5 text-[13px] font-black transition',
                !canPost
                  ? 'cursor-not-allowed bg-bgPrimary/60 text-textPrimary/60'
                  : 'cursor-pointer bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
              ].join(' ')}
            >
              {posting ? '…' : 'Post'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
