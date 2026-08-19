'use client'

// What the CLIENT attached to their submission — an image or a short video of
// the look they spotted.
//
// 🔴 Reviewer-facing only. None of this reaches a client surface until someone
// here presses "Use this", which copies the URL into the request's cover
// (Tori, 2026-08-14: the client can upload, only the admin can set it app-wide).
// Publishing it automatically would put an unvetted photo — quite possibly
// someone else's — on a screen every client sees.
//
// Video can be attached and watched here, but cannot BE the cover: the surfaces
// that show a viral look draw a still image. A reviewer watching a video picks a
// cover by uploading a frame of their own.
//
// "Remove" is the way back out. Rejecting a request stopped FURTHER attachments
// but left the ones already on it in a PUBLIC bucket with no affordance to take
// them down — and a submission can carry someone else's photograph. It deletes
// the object as well as the row entry, so it asks first, and it asks
// differently when the attachment is the live cover.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import RemoteImage from '@/app/_components/media/RemoteImage'
import {
  errorMessageFromUnknown,
  readErrorMessage,
  safeJson,
} from '@/lib/http'
import { isSameUrlIgnoringQuery } from '@/lib/url'

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm']

function isVideo(url: string): boolean {
  const withoutQuery = url.split('?')[0]?.toLowerCase() ?? ''
  return VIDEO_EXTENSIONS.some((ext) => withoutQuery.endsWith(ext))
}

export default function ViralRequestSubmitterMedia({
  requestId,
  media,
  coverImage = null,
}: {
  requestId: string
  media: string[]
  /** The published cover, so removing it can warn before it clears one. */
  coverImage?: string | null
}) {
  const router = useRouter()
  // Which URL is in flight AND which action — one shared `busy` string made
  // "Use this" light up the Remove button's own label instead.
  const [busy, setBusy] = useState<{ url: string; action: 'cover' | 'remove' } | null>(
    null,
  )
  const [err, setErr] = useState<string | null>(null)

  if (media.length === 0) return null

  async function promoteToCover(url: string) {
    setBusy({ url, action: 'cover' })
    setErr(null)
    try {
      const res = await fetch('/api/v1/admin/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE',
          requestId,
          publicUrl: url,
        }),
      })
      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(
          readErrorMessage(raw) ?? `Could not set the cover (${res.status}).`,
        )
      }
      router.refresh()
    } catch (e: unknown) {
      setErr(errorMessageFromUnknown(e, 'Could not set the cover.'))
    } finally {
      setBusy(null)
    }
  }

  async function removeAttachment(url: string) {
    // Clearing a cover is a client-facing change on an approved look, not
    // bookkeeping — so it is the one case that asks first.
    const message = isSameUrlIgnoringQuery(coverImage, url)
      ? 'This attachment is the look’s cover. Removing it deletes the file and clears the cover, so the look will show no picture. Continue?'
      : 'Remove this attachment? The file is deleted from storage and cannot be recovered.'

    if (!window.confirm(message)) return

    setBusy({ url, action: 'remove' })
    setErr(null)
    try {
      const res = await fetch(
        `/api/v1/admin/viral-service-requests/${encodeURIComponent(requestId)}/media`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaUrl: url }),
        },
      )
      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(
          readErrorMessage(raw) ??
            `Could not remove the attachment (${res.status}).`,
        )
      }
      router.refresh()
    } catch (e: unknown) {
      setErr(errorMessageFromUnknown(e, 'Could not remove the attachment.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-2 grid gap-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-textMuted">
        Sent by the client · not published
      </div>
      <div className="flex flex-wrap gap-2">
        {media.map((url) => {
          const video = isVideo(url)
          return (
            <div key={url} className="grid gap-1">
              <div className="grid h-[74px] w-[112px] place-items-center overflow-hidden rounded-[10px] border border-surfaceGlass/12 bg-bgPrimary">
                {video ? (
                  <video
                    src={url}
                    controls
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <RemoteImage
                    src={url}
                    alt="Submitted media"
                    className="h-full w-full object-cover"
                    width={112}
                    height={74}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {video ? (
                  <span className="text-[10px] text-textMuted">
                    Video — upload a still to use as the cover
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void promoteToCover(url)}
                    className="rounded-full border border-surfaceGlass/20 px-2.5 py-1 text-[10.5px] font-black text-textSecondary transition hover:text-textPrimary disabled:opacity-50"
                  >
                    {busy?.url === url && busy.action === 'cover'
                      ? 'Setting…'
                      : 'Use this'}
                  </button>
                )}
                {/* Available for video too — a video is exactly the kind of
                    attachment that has no "Use this" and so had no way out. */}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void removeAttachment(url)}
                  className="rounded-full border border-toneDanger/40 px-2.5 py-1 text-[10.5px] font-black text-toneDanger transition hover:border-toneDanger/70 disabled:opacity-50"
                >
                  {busy?.url === url && busy.action === 'remove'
                    ? 'Removing…'
                    : 'Remove'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {err ? <div className="text-[11.5px] text-toneDanger">{err}</div> : null}
    </div>
  )
}
