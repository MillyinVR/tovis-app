// app/pro/bookings/[id]/session/_components/MediaPreviewGrid.tsx
'use client'

import { useMemo, useState } from 'react'
import MediaFill from '@/app/_components/media/MediaFill'
import MediaFullscreenViewer from '@/app/_components/media/MediaFullscreenViewer'
import { UI_SIZES } from '@/app/(main)/ui/layoutConstants'

type Item = {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  createdAt: string | Date
  reviewId: string | null
  signedUrl: string | null
  signedThumbUrl: string | null
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function fmtDate(v: unknown) {
  try {
    const d = v instanceof Date ? v : new Date(String(v))
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString()
  } catch {
    return ''
  }
}

export default function MediaPreviewGrid({
  items,
  title,
}: {
  items: Item[]
  title: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  const active = useMemo(() => items.find((x) => x.id === openId) ?? null, [items, openId])

  const footerOffsetPx = UI_SIZES.footerHeight ?? 0

  return (
    <>
      <div className="text-sm font-black">{title}</div>

      {items.length === 0 ? (
        <div className="mt-2 text-sm text-textSecondary">None yet.</div>
      ) : (
        <div className="mt-3 grid gap-3">
          {items.map((m) => {
            const previewSrc = m.signedThumbUrl || m.signedUrl
            const openSrc = m.signedUrl || m.signedThumbUrl
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
                  <button
                    type="button"
                    onClick={() => setOpenId(m.id)}
                    className={cx(
                      'mt-2 block w-full overflow-hidden rounded-card border border-white/10 bg-bgPrimary',
                      'focus:outline-none focus:ring-2 focus:ring-accentPrimary/35',
                    )}
                    title="Open fullscreen"
                  >
                    <div className="relative w-full aspect-[9/16]">
                      <MediaFill
                        src={previewSrc}
                        mediaType={m.mediaType}
                        alt="Media preview"
                        fit="cover"
                        className="absolute inset-0 h-full w-full"
                        videoProps={{
                          // previews should not blast audio or go fullscreen randomly
                          muted: true,
                          playsInline: true,
                          preload: 'metadata',
                          controls: false,
                        }}
                      />
                    </div>
                  </button>
                ) : (
                  <div className="mt-2 rounded-card border border-white/10 bg-bgPrimary p-3 text-xs font-semibold text-textSecondary">
                    Couldn’t generate a signed URL (file missing or storage error).
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
                  {wasReleased ? 'Client attached this to a review (released).' : 'Stays private unless the client attaches it to a review.'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {active?.signedUrl ? (
        <MediaFullscreenViewer
          src={active.signedUrl}
          mediaType={active.mediaType}
          alt={active.caption || 'Media'}
          fit="contain"
          showGradients
          footerOffsetPx={footerOffsetPx}
          topLeft={
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className={cx(
                'inline-flex items-center gap-2 rounded-full border border-white/10',
                'bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary',
                'backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.55)]',
                'hover:bg-white/10',
              )}
            >
              ← Back
            </button>
          }
          bottom={
            <div className="pointer-events-none">
              <div className="pointer-events-auto w-full max-w-[680px]">
                <div
                  className={cx(
                    'rounded-[18px] border border-white/10 bg-bgPrimary/25 backdrop-blur-xl',
                    'px-4 py-3',
                    'shadow-[0_18px_60px_rgba(0,0,0,0.65)]',
                  )}
                >
                  {active.caption ? (
                    <div className="text-[14px] font-black leading-snug text-textPrimary">{active.caption}</div>
                  ) : (
                    <div className="text-[12px] font-semibold text-white/70">No caption</div>
                  )}
                </div>
              </div>
            </div>
          }
        />
      ) : null}
    </>
  )
}