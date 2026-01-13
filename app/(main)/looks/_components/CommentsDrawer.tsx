// app/(main)/looks/_components/CommentsDrawer.tsx 

'use client'

type UiComment = {
  id: string
  body: string
  createdAt: string
  user: { id: string; displayName: string; avatarUrl: string | null }
}

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
  if (!open) return null

  return (
    <div onClick={onClose} className="fixed inset-0 z-100 bg-overlay/70">
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 grid max-h-[70dvh] grid-rows-[auto_1fr_auto] gap-2.5 rounded-t-[18px] border border-surfaceGlass/10 bg-bgSecondary p-3 text-textPrimary"
      >
        <div className="flex items-center justify-between">
          <div className="font-black">Comments</div>
          <button onClick={onClose} className="text-textPrimary/80">
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
                      <img src={c.user.avatarUrl} alt="" className="h-full w-full object-cover" />
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
            <div className="text-textSecondary">No comments yet.</div>
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment…"
            className="flex-1 rounded-full border border-surfaceGlass/15 bg-surfaceGlass/10 px-3 py-2.5 text-[13px] text-textPrimary outline-none placeholder:text-textSecondary/70 backdrop-blur-xl"
          />
          <button
            onClick={onPost}
            disabled={posting || !commentText.trim()}
            className={[
              'rounded-full px-3.5 py-2.5 font-black transition',
              posting || !commentText.trim()
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
