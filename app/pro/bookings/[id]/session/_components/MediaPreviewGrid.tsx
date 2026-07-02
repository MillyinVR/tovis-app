// app/pro/bookings/[id]/session/_components/MediaPreviewGrid.tsx
'use client'

import ClickableMedia from '@/app/_components/media/ClickableMedia'
import { UI_SIZES } from '@/app/(main)/ui/layoutConstants'
import { DEFAULT_TIME_ZONE, formatInTimeZone, getViewerTimeZone } from '@/lib/time'

type Item = {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  createdAt: string | Date
  reviewId: string | null

  // ✅ single source of truth for UI rendering
  renderUrl: string | null
  renderThumbUrl: string | null
}

function fmtDate(v: unknown) {
  try {
    const d = v instanceof Date ? v : new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    return formatInTimeZone(d, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function MediaPreviewGrid({ items, title }: { items: Item[]; title: string }) {
  const footerOffsetPx = UI_SIZES.footerHeight ?? 0

  return (
    <>
      <div className="text-sm font-black">{title}</div>

      {items.length === 0 ? (
        <div className="mt-2 text-sm text-textSecondary">None yet.</div>
      ) : (
        <div className="mt-3 grid gap-3">
          {items.map((m) => {
            const previewSrc = m.renderThumbUrl || m.renderUrl
            const openSrc = m.renderUrl || m.renderThumbUrl
            const when = fmtDate(m.createdAt)
            const wasReleased = Boolean(m.reviewId)

            return (
              <div key={m.id} className="rounded-card border border-white/10 bg-bgSecondary p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-black text-textPrimary">
                  <span>{m.mediaType} · PRIVATE</span>
                  {when ? <span className="font-semibold text-textSecondary">· {when}</span> : null}
                </div>

                {m.caption ? <div className="mt-1 text-sm text-textSecondary">{m.caption}</div> : null}

                {previewSrc ? (
                  <ClickableMedia
                    thumbSrc={previewSrc}
                    fullSrc={openSrc}
                    mediaType={m.mediaType}
                    alt="Media preview"
                    caption={m.caption}
                    footerOffsetPx={footerOffsetPx}
                    className="mt-2 aspect-[9/16] w-full rounded-card border border-white/10 bg-bgPrimary"
                  />
                ) : (
                  <div className="mt-2 rounded-card border border-white/10 bg-bgPrimary p-3 text-xs font-semibold text-textSecondary">
                    Couldn’t generate a render URL (file missing or storage error).
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-3 text-xs font-black">
                  {openSrc ? (
                    <a href={openSrc} target="_blank" rel="noreferrer" className="text-accentPrimary hover:opacity-80">
                      Open in new tab
                    </a>
                  ) : null}
                </div>

                <div className="mt-2 text-[11px] font-semibold text-textSecondary">
                  {wasReleased
                    ? 'Client attached this to a review (released).'
                    : 'Stays private unless the client attaches it to a review.'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
